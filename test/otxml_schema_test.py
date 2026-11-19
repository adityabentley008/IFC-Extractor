import json
import subprocess
import unittest
from pathlib import Path

from lxml import etree


PACKAGE = Path(__file__).resolve().parent.parent


class OtxmlSchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = etree.XMLSchema(etree.parse(str(PACKAGE / "schema" / "otxml.xsd")))
        script = """
const { convertIfcToOtxml } = require('./.test-build/src/IfcToOtxml');
const { fixture } = require('./.test-build/test/fixtures/TowerIfc');
const partial = fixture('solid').replace(/('No\\. of Panels',\\$,IFCTEXT\\()'1'/, "$1'46'");
console.log(JSON.stringify([
  convertIfcToOtxml(fixture()).xml,
  convertIfcToOtxml(partial, { allowPartial: true }).xml,
]));
"""
        output = subprocess.run(
            ["node", "-e", script], cwd=PACKAGE, capture_output=True, text=True, check=True
        )
        cls.outputs = json.loads(output.stdout)

    def test_converter_outputs_and_original_panel_form_validate(self):
        for xml in self.outputs:
            with self.subTest(xml=xml[:100]):
                self.schema.assertValid(etree.fromstring(xml.encode("utf-8")))
        self.schema.assertValid(etree.fromstring(
            b'<Staad><ProjectData/><PanelProperties><Panel PanelID="1"/></PanelProperties>'
            b'<Panel ID="1"/><Nodes/><Sections><Section ID="1"/></Sections></Staad>'
        ))

    def test_unknown_elements_and_attributes_are_rejected(self):
        for xml in (
            b"<Staad><Unexpected/></Staad>",
            b'<Staad><Panel Unknown="value"/></Staad>',
            b"<Staad><Panel><Node/></Panel></Staad>",
        ):
            with self.subTest(xml=xml):
                self.assertFalse(self.schema.validate(etree.fromstring(xml)))


if __name__ == "__main__":
    unittest.main()
