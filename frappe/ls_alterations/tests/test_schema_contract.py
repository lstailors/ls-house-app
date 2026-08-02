import json
import unittest
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
DOCTYPE_ROOT = APP_ROOT / "ls_alterations" / "ls_alterations" / "doctype"


def _doctype(name: str) -> dict:
    path = DOCTYPE_ROOT / name / f"{name}.json"
    return json.loads(path.read_text())


class TestAlterationsSchemaContract(unittest.TestCase):
    def test_ticket_line_intake_persistence_fields_are_versioned(self):
        fields = {
            field["fieldname"]: field
            for field in _doctype("alteration_ticket_line")["fields"]
        }

        expected = {
            "estimated_minutes": "Int",
            "client_line_key": "Data",
            "line_photos": "Long Text",
        }
        self.assertEqual(
            {name: fields[name]["fieldtype"] for name in expected},
            expected,
        )

    def test_card_on_file_is_a_valid_ticket_payment_method(self):
        fields = {
            field["fieldname"]: field
            for field in _doctype("alteration_ticket")["fields"]
        }
        options = fields["square_payment_method"]["options"].splitlines()

        self.assertIn("Card on File", options)

    def test_schema_repair_patch_is_registered(self):
        patches = (APP_ROOT / "ls_alterations" / "patches.txt").read_text()

        self.assertIn(
            "ls_alterations.patches.v2_0.repair_alteration_schema",
            patches,
        )

    def test_card_on_file_provenance_is_not_best_effort(self):
        source = (APP_ROOT / "ls_alterations" / "ls_square" / "pos.py").read_text()
        charge_source = source.split("def charge_card_on_file", maxsplit=1)[1]

        self.assertNotIn("# Best-effort ticket method label", charge_source)
        self.assertNotIn("except Exception:\n        pass", charge_source)
        self.assertIn(
            'if status in ("COMPLETED", "APPROVED") and payment_id:',
            charge_source,
        )


if __name__ == "__main__":
    unittest.main()
