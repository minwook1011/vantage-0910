import copy
import io
import json
import unittest
from contextlib import ExitStack, redirect_stdout
from datetime import date, timedelta
from unittest.mock import mock_open, patch

import fetch_macro as macro
import fetch_macro_dash as dash


class MacroWatchTests(unittest.TestCase):
    def setUp(self):
        self.previous = {
            "updated": "2026-10-03 12:00 KST",
            "indicators": {"cpi": {"latest": {"date": "2026-08", "value": 2.5}}},
            "markets": {"^GSPC": {"d": ["2026-10-02"], "c": [6000], "v": [100]}},
            "calendar": [{"date": "2026-10-15", "key": "cpi"}],
            "status": {"bls": "ok"},
            "custom_metadata": {"preserve": True},
            "yields": {"dates": ["2025-10-03", "2026-10-02"], "3M": [4.0, 4.0], "2Y": [4.0, 4.1],
                       "5Y": [4.1, 4.15], "10Y": [4.2, 4.3], "30Y": [4.3, 4.4],
                       "10Y2Y": [0.2, 0.2], "10Y3M": [0.2, 0.3], "thinned": True},
        }
        self.fresh_rows = {"2026-10-05": {"3M": 4.0, "2Y": 4.1, "5Y": 4.15, "10Y": 4.2, "30Y": 4.4}}
        self.wti = {"d": ["2026-10-02", "2026-10-05"], "c": [70.0, 72.5], "v": [120, 130]}

    @staticmethod
    def written_data(writer):
        return json.loads("".join(call.args[0] for call in writer().write.call_args_list))

    def run_watch(self, treasury_error=None, wti_error=None):
        writer = mock_open()
        with ExitStack() as stack:
            stack.enter_context(redirect_stdout(io.StringIO()))
            stack.enter_context(patch("builtins.open", writer))
            stack.enter_context(patch.object(dash.os, "replace"))
            stack.enter_context(patch.object(dash, "TODAY", date(2026, 10, 6)))
            stack.enter_context(patch.object(dash, "load_prev", return_value=copy.deepcopy(self.previous)))
            treasury = stack.enter_context(patch.object(dash, "fetch_treasury", side_effect=treasury_error,
                                                        return_value=(list(self.fresh_rows), self.fresh_rows)))
            stack.enter_context(patch.object(dash, "fetch_yahoo", side_effect=wti_error, return_value=copy.deepcopy(self.wti)))
            for name in ("fetch_bls", "fetch_nipa", "fetch_effr", "fetch_claims", "fetch_umich",
                         "calendar_bls", "calendar_fomc", "calendar_bea", "calendar_claims"):
                stack.enter_context(patch.object(dash, name, side_effect=AssertionError(name + " must not run")))
            code = dash.main(watch_only=True)
        treasury.assert_called_once_with(years=1)
        return code, self.written_data(writer)

    def test_watch_updates_observations_and_preserves_other_data(self):
        code, data = self.run_watch()
        self.assertEqual(code, 0)
        self.assertEqual(data["indicators"]["wti"]["latest"],
                         {"date": "2026-10-05", "value": 72.5, "prev": 70.0, "chg": 2.5})
        self.assertEqual(data["indicators"]["s10y2y"]["latest"]["value"], 0.1)
        self.assertEqual(data["indicators"]["cpi"], self.previous["indicators"]["cpi"])
        self.assertEqual(data["markets"]["^GSPC"], self.previous["markets"]["^GSPC"])
        for key in ("calendar", "custom_metadata"):
            self.assertEqual(data[key], self.previous[key])
        self.assertTrue(set(self.previous["yields"]["dates"]).issubset(data["yields"]["dates"]))
        self.assertEqual(data["status"]["bls"], "ok")

    def test_watch_all_failed_preserves_values_and_last_success_time(self):
        code, data = self.run_watch(RuntimeError("offline"), RuntimeError("offline"))
        self.assertEqual(code, 1)
        for key in ("updated", "indicators", "markets", "yields", "calendar", "custom_metadata"):
            self.assertEqual(data[key], self.previous[key])
        self.assertIn("watch_checked", data)
        self.assertTrue(all(value.startswith("fail:") for value in data["watch_status"].values()))

    def test_watch_partial_failure_preserves_failed_source(self):
        code, data = self.run_watch(treasury_error=RuntimeError("offline"))
        self.assertEqual(code, 0)
        self.assertEqual(data["yields"], self.previous["yields"])
        self.assertEqual(data["watch_status"]["wti"], "ok")
        self.assertTrue(data["watch_status"]["treasury"].startswith("fail:"))

    def test_watch_older_wti_response_does_not_replace_saved_values(self):
        self.previous["markets"]["CL=F"] = {"d": ["2026-10-06"], "c": [73.0], "v": [150]}
        self.previous["indicators"]["wti"] = {"latest": {"date": "2026-10-06", "value": 73.0}}
        _, data = self.run_watch()
        self.assertEqual(data["markets"]["CL=F"], self.previous["markets"]["CL=F"])
        self.assertEqual(data["indicators"]["wti"], self.previous["indicators"]["wti"])
        self.assertTrue(data["watch_status"]["wti"].startswith("fail:"))


class MacroMarketOnlyTests(unittest.TestCase):
    def setUp(self):
        self.previous = {"macro_monthly": {"cpi": [{"date": "2026-08", "value": 2.5}]}, "custom_metadata": 7}
        self.rows = [((date(2025, 1, 1) + timedelta(days=i)).isoformat(), 100.0 + i * 0.1 + (i % 7) * 0.2)
                     for i in range(500)]

    def run_market(self, provider):
        writer = mock_open(read_data=json.dumps(self.previous))
        with ExitStack() as stack:
            stack.enter_context(redirect_stdout(io.StringIO()))
            stack.enter_context(patch("builtins.open", writer))
            stack.enter_context(patch.object(macro.os, "replace"))
            stack.enter_context(patch.object(macro, "fetch_yahoo", side_effect=provider))
            for name in ("fetch_fred", "fetch_bls_series", "fetch_treasury_10y"):
                stack.enter_context(patch.object(macro, name, side_effect=AssertionError(name + " must not run")))
            code = macro.main(market_only=True)
        return code, writer

    def test_market_only_preserves_economics_and_custom_fields(self):
        code, writer = self.run_market(lambda ticker, period: self.rows)
        self.assertIn(code, (None, 0))
        data = MacroWatchTests.written_data(writer)
        self.assertEqual(data["macro_monthly"], self.previous["macro_monthly"])
        self.assertEqual(data["custom_metadata"], 7)
        self.assertEqual(data["latest_fear_greed_date"], self.rows[-1][0])

    def test_market_only_incomplete_component_preserves_entire_file(self):
        code, writer = self.run_market(lambda ticker, period: [] if ticker == "HYG" else self.rows)
        self.assertEqual(code, 1)
        writer().write.assert_not_called()

    def test_market_only_stale_component_preserves_entire_file(self):
        code, writer = self.run_market(lambda ticker, period: self.rows[:-1] if ticker == "TLT" else self.rows)
        self.assertEqual(code, 1)
        writer().write.assert_not_called()

    def test_market_only_previous_component_date_must_not_regress(self):
        self.previous["market_observed"] = {"vix": "2026-10-05"}
        code, writer = self.run_market(lambda ticker, period: self.rows)
        self.assertEqual(code, 1)
        writer().write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
