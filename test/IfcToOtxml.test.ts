import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Element, xml2js } from "xml-js";
import { convertIfcToOtxml } from "../src/IfcToOtxml";
import { convertIfcFiles } from "../src/ConvertIfc";
import { angleContour, fixture } from "./fixtures/TowerIfc";
import { convertIfcToCommonData } from "../src/IfcToCommonData";
import { convertIfcToCommonDataFiles } from "../src/ConvertIfcToCommonData";

function all(node: Element, name: string): Element[] {
    const found = node.name === name ? [node] : [];
    return found.concat(...(node.elements || []).map((child) => all(child, name)));
}

describe("OpenTower IFC to OTXML", () => {
    it("extracts unfamiliar nested groups and named properties without a component allowlist", () => {
        const input = fixture();
        const panel = /^#(\d+)=IFCBUILDINGSTOREY/m.exec(input)![1];
        const beam = /^#(\d+)=IFCBEAM\('beam0false'/m.exec(input)![1];
        const reparented = input.replace(new RegExp(`^(#\\d+=IFCRELNESTS\\('nest',\\$,\\$,\\$,)#\\d+,\\(#${beam}\\)`, "m"),
            `$1#9001,(#${beam})`);
        const extended = reparented.replace(/\r?\nENDSEC;\r?\nEND-ISO/, `
#9000=IFCBUILDINGELEMENTPART('group',$,'Future Assembly',$,$,$,$,$);
#9001=IFCCURTAINWALL('subgroup',$,'Auxiliary Bracing 7',$,$,$,$,$);
#9002=IFCRELNESTS('nest',$,$,$,#${panel},(#9000));
#9003=IFCRELAGGREGATES('aggregate',$,$,$,#9000,(#9001));
#9004=IFCPROPERTYSINGLEVALUE('ComponentName',$,IFCLABEL('AuxiliaryBracing'),$);
#9005=IFCPROPERTYLISTVALUE('Design Factors',$,(IFCREAL(1.25),IFCREAL(1.5)),$);
#9006=IFCPROPERTYSET('props',$,'Unfamiliar Pset',$,(#9004,#9005));
#9007=IFCRELDEFINESBYPROPERTIES('props',$,$,$,(#9001,#${panel}),#9006);
ENDSEC;
END-ISO`);
        const { data } = convertIfcToCommonData(extended, "future.ifc");
        const group = data.panels[0].memberGroups![0].memberGroups![0];
        assert.equal(group.label, "Auxiliary Bracing 7");
        assert.equal(group.type, "AuxiliaryBracing");
        assert.deepEqual(group.members, [beam]);
        const member = data.members.find((entry) => entry.id === beam)!;
        assert(data.nodes.some((node) => node.id === member.startNodeId));
        assert(data.sections.some((section) => section.id === member.sectionId));
        assert.deepEqual(data.panels[0].propertySets?.find((set) => set.name === "Unfamiliar Pset")?.properties[1].value, [1.25, 1.5]);
    });

    it("keeps a member and its endpoint references when section geometry cannot be recovered", () => {
        const { data, warnings } = convertIfcToCommonData(fixture("tapered"), "tapered.ifc");
        const member = data.members.find((entry) => entry.extractionIssues?.some((issue) => /constant-section/.test(issue)))!;
        assert(member);
        assert.equal(member.sectionId, undefined);
        assert(data.nodes.some((node) => node.id === member.startNodeId));
        assert(data.nodes.some((node) => node.id === member.endNodeId));
        assert(warnings.some((warning) => warning.includes("incomplete normalization")));
    });

    it("extracts common data directly with hierarchy, materials and mesh contour", () => {
        const result = convertIfcToCommonData(fixture(), "sample.ifc");
        const data = result.data;
        assert.deepEqual(result.counts, { panels: 1, legs: 3, bracingMembers: 3, nodes: 6 });
        assert.equal(data.source.format, "IFC");
        assert.equal(data.panels[0].legs.length, 3);
        assert.equal(data.panels[0].faces.length, 3);
        assert.equal(data.members.length, 6);
        assert.equal(data.sections[0].contour!.length, 6);
        assert.equal(data.materials[0].propertiesSource, "assumed");
        assert(data.members.some((member) => member.materialAssignmentSource === "assumed"));
        assert.equal(data.members[0].startRelease, "00000");
        assert.equal(data.projectData.location.altitudeMetres, 682.025);
        assert.equal(data.projectData.siteName, undefined);
    });

    it("requires explicit partial permission for common JSON and preserves declared counts", () => {
        const input = fixture("solid").replace(/('No\. of Panels',\$,IFCTEXT\()'1'/, "$1'46'");
        assert.throws(() => convertIfcToCommonData(input, "partial.ifc"), /declares 46 panels/);
        const result = convertIfcToCommonData(input, "partial.ifc", { allowPartial: true });
        assert.equal(result.data.towerInformation.declaredPanelCount, 46);
        assert.equal(result.data.towerInformation.partialExport, true);
        assert.equal(result.data.panels.length, 1);
        assert.equal(result.data.sections[0].contour, undefined);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifc-common-"));
        const ifc = path.join(directory, "partial.ifc");
        const output = path.join(directory, "output.json");
        try {
            fs.writeFileSync(ifc, input);
            convertIfcToCommonDataFiles([ifc, output, "--allow-partial"]);
            assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), result.data);
            assert.throws(() => convertIfcToCommonDataFiles([ifc, output, "--allow-partial"]), /EEXIST/);
        } finally {
            for (const file of [ifc, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
            fs.rmdirSync(directory);
        }
    });

    it("recovers explicit members and L-shape contours from mapped IFC geometry without any OTXML input", () => {
        const result = convertIfcToOtxml(fixture());
        const xml = xml2js(result.xml, { compact: false }) as Element;
        assert.deepEqual(result.counts, { panels: 1, legs: 3, bracingMembers: 3, nodes: 6 });
        assert.equal(all(xml, "Face").length, 3);
        const members = all(xml, "PhysicalMember");
        assert.equal(members.length, 6);
        const nodes = all(xml, "Node");
        const legA = all(xml, "Leg").find((leg) => leg.attributes!.Name === "A")!;
        const firstLegMember = all(legA, "PhysicalMember")[0];
        const start = nodes.find((n) => n.attributes!.ID === firstLegMember.attributes!.StartNodeID)!;
        assert.equal(start.attributes!.Y, "1");
        assert.equal(start.attributes!.Z, "-1");
        assert.equal(members[0].attributes!.StartRelease, "00000");
        assert.equal(members[3].attributes!.BetaAngle, "180");
        assert.equal(all(xml, "PanelProperty")[0].attributes!.Height, "6.56");
        assert.equal(all(xml, "Segment")[0].attributes!.Name, "X 'Brace'; /* label */");
        assert.equal(all(xml, "TowerInformation")[0].attributes!.TowerName, "Test & Tower");
        assert.equal(all(xml, "ProjectData")[0].attributes!.Site_Altitude, "682.025");
        const contour = all(xml, "PolyLine").map((p) => [Number(p.attributes!.X), Number(p.attributes!.Z)]);
        assert.equal(contour.length, 6);
        for (const [x, z] of angleContour) assert(contour.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1e-10));
        assert(Number(all(xml, "Section")[0].attributes!.Width) > 0);
        assert.equal(all(xml, "Section")[0].attributes!.ID, members[0].attributes!.SectionID);
        const property = all(xml, "MaterialProperty")[0].attributes!;
        assert.equal(property.Value, "205000");
        assert.equal(property.RefID, members[0].attributes!.MaterialID);
        assert.equal(all(xml, "Material").length, 2);
        assert(result.warnings.some((w) => w.includes("3 members assigned 'Default Steel'")));
        assert(result.warnings.some((w) => w.includes("3 members have five-character")));
    });

    it("recovers a horizontal member profile with beta rotation instead of baking beta into the contour", () => {
        const result = convertIfcToOtxml(fixture("angle", true));
        const xml = xml2js(result.xml, { compact: false }) as Element;
        const points = all(xml, "PolyLine").map((p) => [Number(p.attributes!.X), Number(p.attributes!.Z)]);
        for (const [x, z] of angleContour) assert(points.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1e-10));
        assert(all(xml, "PhysicalMember").every((m) => m.attributes!.BetaAngle === "180"));
    });

    it("recovers the hollow-circle outer contour and wall thickness from cap mesh boundaries", () => {
        const result = convertIfcToOtxml(fixture("tube"));
        const xml = xml2js(result.xml, { compact: false }) as Element;
        const section = all(xml, "Section")[0].attributes!;
        assert.equal(section.Name, "HollowCircleProfile");
        assert.equal(all(xml, "PolyLine").length, 8);
        assert(Math.abs(Number(section.Radius) / 39.3701 - 0.025) < 1e-10);
        assert(Math.abs(Number(section.WallThickness) / 39.3701 - 0.004) < 1e-10);
        for (const point of all(xml, "PolyLine")) {
            assert(Math.abs(Math.hypot(Number(point.attributes!.X), Number(point.attributes!.Z)) - 0.025) < 1e-10);
        }
    });

    it("fails explicitly for unsupported geometry and rejects the obsolete catalog CLI arguments", () => {
        assert.throws(() => convertIfcToOtxml(fixture().replace("=IFCFACETEDBREP(", "=IFCUNSUPPORTEDBREP(")), /Missing or invalid/);
        assert.throws(() => convertIfcFiles(["tower.ifc", "tower.otxml", "--catalog", "old.otxml"]), /Usage/);
        assert.throws(() => convertIfcFiles(["tower.ifc", "tower.ifc"]), /overwrite/);
        assert.throws(() => convertIfcFiles(["tower.ifc", "tower.otxml", "--unknown"]), /Usage/);
    });

    it("recovers tilted OpenTower solid circles and separates different sizes behind the same generic label", () => {
        const result = convertIfcToOtxml(fixture("solid", false, true));
        const xml = xml2js(result.xml, { compact: false }) as Element;
        const sections = all(xml, "Section");
        assert.equal(sections.length, 3);
        assert.equal(all(xml, "PolyLine").length, 0);
        const braces = all(xml, "PhysicalMember").slice(3);
        const radii = braces.map((m) => Number(sections.find((s) => s.attributes!.ID === m.attributes!.SectionID)!.attributes!.Radius) / 39.3701).sort((a, b) => a - b);
        assert(Math.abs(radii[0] - 0.025) < 1e-10);
        assert(Math.abs(radii[1] - 0.025) < 1e-10);
        assert(Math.abs(radii[2] - 0.05) < 1e-10);
        assert.equal(new Set(braces.map((m) => m.attributes!.SectionID)).size, 2);
        assert.equal(sections[0].attributes!.WallThickness, "0.157");
        const tower = all(xml, "TowerInformation")[0].attributes!;
        assert.equal(tower.Convention, "OpenTower");
        assert.equal(tower.UnitSystem, "Imperial");
        assert.equal(tower.TowerShape, undefined);
        assert.equal(tower.TowerTiltX, "0.07");
        assert.equal(tower.TowerTiltY, "0.01");
        assert.equal(tower.ConcreteHeight, "1.14");
        assert.throws(() => convertIfcToOtxml(fixture("tapered")), /constant-section/);
    });

    it("recovers the connector's parametric L depth and thickness rather than treating its shortest edge as wall thickness", () => {
        const result = convertIfcToOtxml(fixture("parametricAngle", true));
        const xml = xml2js(result.xml, { compact: false }) as Element;
        assert.equal(all(xml, "PolyLine").length, 0);
        for (const section of all(xml, "Section")) {
            assert(Math.abs(Number(section.attributes!.Depth) / 39.3701 - 0.05) < 1e-10);
            assert(Math.abs(Number(section.attributes!.Thickness) / 39.3701 - 0.004) < 1e-10);
        }
        assert(all(xml, "PhysicalMember").every((m) => m.attributes!.BetaAngle === "180"));
        assert.throws(() => convertIfcToOtxml(fixture("tube").replace("'MS TOWER'", "'OpenTower'")), /one solid parametric section contour/);
    });

    it("requires explicit partial-export permission and records actual and source panel counts through the CLI", () => {
        const inputIfc = fixture("solid").replace(/('No\. of Panels',\$,IFCTEXT\()'1'/, "$1'46'");
        assert.throws(() => convertIfcToOtxml(inputIfc), /declares 46 panels but exports 1/);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifc-partial-"));
        const input = path.join(directory, "input.ifc");
        const output = path.join(directory, "output.otxml");
        try {
            fs.writeFileSync(input, inputIfc);
            convertIfcFiles([input, output, "--allow-partial"]);
            const xml = xml2js(fs.readFileSync(output, "utf8"), { compact: false }) as Element;
            const tower = all(xml, "TowerInformation")[0].attributes!;
            assert.equal(all(xml, "Panel").length, 1);
            assert.equal(tower.NoofPanel, "1");
            assert.equal(tower.SourcePanelCount, "46");
            assert.equal(tower.PartialExport, "True");
            assert(convertIfcToOtxml(inputIfc, { allowPartial: true }).warnings.some((w) => w.includes("45 panels are missing")));
            assert.throws(() => convertIfcFiles([input, output, "--allow-partial"]), /EEXIST/);
            assert.throws(() => convertIfcToOtxml(inputIfc.replace(/('PanelID',\$,IFCTEXT\()'1'/, "$1'2'"), { allowPartial: true }), /consecutive/);
        } finally {
            for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
            fs.rmdirSync(directory);
        }
    });

    it("rejects orphaned members, cycles and incomplete documents instead of silently dropping data", () => {
        assert.throws(() => convertIfcToOtxml(fixture().replace(/#\d+=IFCRELNESTS[^;]+;\n/, "")), /hierarchy|unparented|nesting/);
        const tower = /#(\d+)=IFCBUILDING\(/.exec(fixture())![1];
        const panel = /#(\d+)=IFCBUILDINGSTOREY\(/.exec(fixture())![1];
        const cycle = fixture().replace("\nENDSEC;\nEND-ISO", `\n#99999=IFCRELNESTS('cycle',$,$,$,#${panel},(#${tower}));\nENDSEC;\nEND-ISO`);
        assert.throws(() => convertIfcToOtxml(cycle), /Cyclic/);
        assert.throws(() => convertIfcToOtxml(fixture().replace("END-ISO-10303-21;", "")), /Incomplete/);
        assert.throws(() => convertIfcToOtxml(fixture().replace("'0,1,-1'", "'NaN,1,-1'")), /Invalid number/);
    });

    it("rejects incompatible conventions and units", () => {
        assert.throws(() => convertIfcToOtxml(fixture().replace("'IFC2X3'", "'IFC4'")), /IFC2X3/);
        assert.throws(() => convertIfcToOtxml(fixture().replace(".LENGTHUNIT.,$,.METRE.", ".LENGTHUNIT.,.MILLI.,.METRE.")), /must be metres/);
        assert.throws(() => convertIfcToOtxml(fixture().replace("'MS TOWER'", "'OTHER'")), /MS TOWER/);
    });
});
