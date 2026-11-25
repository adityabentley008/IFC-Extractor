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

function monopoleFixture(): string {
    const input = fixture("solid");
    const tower = /^#(\d+)=IFCBUILDING\('tower'/m.exec(input)![1];
    const panel = /^#(\d+)=IFCBUILDINGSTOREY\('panel'/m.exec(input)![1];
    return input.replace("IFCTEXT('SelfSupported')", "IFCTEXT('Monopole')")
        .replace(new RegExp(`^#\\d+=IFCRELNESTS\\('nest',\\$,\\$,\\$,#${tower},\\(#${panel}\\)\\);\\r?\\n`, "m"), "")
        .replace(/\r?\nENDSEC;\r?\nEND-ISO/, `
#9000=IFCBUILDINGELEMENTPART('base',$,'Base',$,$,$,$,$);
#9001=IFCBUILDINGSTOREY('pole',$,'Pole 1',$,$,$,$,$,.ELEMENT.,$);
#9002=IFCPROPERTYSINGLEVALUE('ComponentName',$,IFCTEXT('BaseStructure'),$);
#9003=IFCPROPERTYSET('baseprops',$,'[OpenTower].[Base]',$,(#9002));
#9004=IFCRELDEFINESBYPROPERTIES('props',$,$,$,(#9000),#9003);
#9005=IFCPROPERTYSINGLEVALUE('ComponentName',$,IFCTEXT('Pole'),$);
#9006=IFCPROPERTYSINGLEVALUE('Pole ID',$,IFCINTEGER(1),$);
#9007=IFCPROPERTYSINGLEVALUE('User Label',$,IFCTEXT('Pole 1'),$);
#9008=IFCPROPERTYSINGLEVALUE('StartPoint',$,IFCTEXT('0,30,0'),$);
#9009=IFCPROPERTYSINGLEVALUE('EndPoint',$,IFCTEXT('0,0,0'),$);
#9010=IFCPROPERTYSINGLEVALUE('Length of the Section',$,IFCREAL(98.68),$);
#9011=IFCPROPERTYSINGLEVALUE('Thickness of Pole',$,IFCREAL(0.02),$);
#9012=IFCPROPERTYSINGLEVALUE('SectionProfile of Pole',$,IFCTEXT('TT508'),$);
#9013=IFCPROPERTYSET('poleprops',$,'[OpenTower].[Pole]',$,(#9005,#9006,#9007,#9008,#9009,#9010,#9011,#9012));
#9014=IFCRELDEFINESBYPROPERTIES('props',$,$,$,(#9001),#9013);
#9015=IFCRELNESTS('nest',$,$,$,#${tower},(#9000));
#9016=IFCRELNESTS('nest',$,$,$,#9000,(#9001));
#9017=IFCRELAGGREGATES('aggregate',$,$,$,#9000,(#9001));
#9018=IFCBUILDINGELEMENTPART('mount',$,'Mount',$,$,$,$,$);
#9019=IFCRELNESTS('nest',$,$,$,#9001,(#9018));
#9020=IFCBUILDINGELEMENTPART('rad',$,'RadCenter',$,$,$,$,$);
#9021=IFCPROPERTYSINGLEVALUE('ComponentName',$,IFCTEXT('RadCenter'),$);
#9022=IFCPROPERTYSINGLEVALUE('Elevation',$,IFCTEXT('94.55'),$);
#9023=IFCPROPERTYSINGLEVALUE('Operator',$,IFCTEXT('-'),$);
#9024=IFCPROPERTYSET('radprops',$,'[OpenTower].[RadCenter]',$,(#9021,#9022,#9023));
#9025=IFCRELDEFINESBYPROPERTIES('props',$,$,$,(#9020),#9024);
#9026=IFCRELNESTS('nest',$,$,$,#${tower},(#9020));
ENDSEC;
END-ISO`);
}

describe("OpenTower IFC to OTXML", () => {
    it("extracts pole members and endpoints without inventing sections or panels", () => {
        const { data } = convertIfcToCommonData(monopoleFixture(), "pole.ifc");
        assert.equal(data.towerInformation.type, "Monopole");
        assert.equal(data.panels, undefined);
        assert.equal(data.towerInformation.declaredPanelCount, undefined);
        assert.equal(data.towerInformation.numberOfLegs, undefined);
        assert.equal(data.poles!.length, 1);
        const pole = data.poles![0];
        assert.equal(pole.id, "1");
        assert.equal(pole.sourceIfcId, "9001");
        assert.equal(pole.parentIfcId, "9000");
        assert.equal(pole.sectionLength, 98.68);
        assert.equal(pole.thickness, 0.02);
        assert.equal(pole.sectionProfile, "TT508");
        assert.deepEqual(pole.members, ["9001"]);
        const member = data.members.find((entry) => entry.id === pole.members[0])!;
        assert.equal(member.sourceKind, "pole");
        assert.equal(member.sectionId, undefined);
        assert.equal(member.betaAngleDegrees, undefined);
        assert.equal(member.materialId, undefined);
        assert.deepEqual(data.nodes.find((node) => node.id === member.startNodeId), { id: member.startNodeId, x: 0, y: 30, z: 0 });
        assert.deepEqual(data.nodes.find((node) => node.id === member.endNodeId), { id: member.endNodeId, x: 0, y: 0, z: 0 });
        assert.equal(pole.memberGroups![0].label, "Mount");
        assert.equal(data.towerInformation.memberGroups![0].id, pole.parentIfcId);
        assert.equal(data.members.length, 1);
        assert.deepEqual(data.sections, []);
        assert.equal(data.units.poleDimensions!.unit, "unknown");
    });

    it("handles multiple poles, incomplete endpoints, and invalid pole hierarchies", () => {
        const input = monopoleFixture();
        const second = input.replace(/\r?\nENDSEC;\r?\nEND-ISO/, `
#9100=IFCBUILDINGSTOREY('pole2',$,'Pole 2',$,$,$,$,$,.ELEMENT.,$);
#9101=IFCPROPERTYSINGLEVALUE('Pole ID',$,IFCINTEGER(2),$);
#9102=IFCPROPERTYSET('pole2props',$,'[OpenTower].[Pole]',$,(#9005,#9101,#9009));
#9103=IFCRELDEFINESBYPROPERTIES('props',$,$,$,(#9100),#9102);
#9104=IFCRELNESTS('nest',$,$,$,#9000,(#9100));
ENDSEC;
END-ISO`);
        const result = convertIfcToCommonData(second, "poles.ifc");
        const pole = result.data.poles!.find((item) => item.id === "2")!;
        assert.equal(result.data.poles!.length, 2);
        const member = result.data.members.find((item) => item.id === pole.members[0])!;
        const first = result.data.members.find((item) => item.id === result.data.poles![0].members[0])!;
        assert.equal(member.endNodeId, first.endNodeId);
        assert(member.extractionIssues!.some((issue) => issue.includes("StartPoint")));
        assert(result.warnings.some((warning) => warning.includes("incomplete normalization")));
        assert.throws(() => convertIfcToCommonData(second.replace("IFCINTEGER(2)", "IFCINTEGER(1)"), "duplicate.ifc"), /Duplicate pole ID/);
        assert.throws(() => convertIfcToCommonData(input.replace("#9000,(#9001));", "#9018,(#9001));"), "cycle.ifc"), /Cyclic IFC nesting|invalid pole hierarchy/i);
        assert.throws(() => convertIfcToCommonData(input.replace("IFCREAL(0.02)", "IFCTEXT('bad')"), "bad.ifc"), /Thickness of Pole/);
    });

    it("keeps normalized pole data when compact is combined with the other CLI flags", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifc-pole-"));
        const input = path.join(directory, "input.ifc");
        const output = path.join(directory, "output.json");
        try {
            fs.writeFileSync(input, monopoleFixture());
            convertIfcToCommonDataFiles([input, output, "--compact", "--allowPartial", "--calculateSectionProfiles"]);
            const data = JSON.parse(fs.readFileSync(output, "utf8"));
            assert.equal(data.poles[0].sectionLength, 98.68);
            assert.equal(data.poles[0].propertySets, undefined);
            assert.equal(data.panels, undefined);
            const member = data.members.find((item: { id: string }) => item.id === data.poles[0].members[0]);
            assert(data.nodes.some((node: { id: string }) => node.id === member.startNodeId));
            const rad = data.towerInformation.memberGroups.find((group: { type: string }) => group.type === "RadCenter");
            assert.equal(rad.sourceAttributes.Elevation, "94.55");
            assert.equal(rad.sourceAttributes.Operator, "-");
            assert.equal(rad.propertySets, undefined);
        } finally {
            for (const file of [input, output]) if (fs.existsSync(file)) fs.unlinkSync(file);
            fs.rmdirSync(directory);
        }
    });

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
        const group = data.panels![0].memberGroups![0].memberGroups![0];
        assert.equal(group.label, "Auxiliary Bracing 7");
        assert.equal(group.type, "AuxiliaryBracing");
        assert.deepEqual(group.members, [beam]);
        const member = data.members.find((entry) => entry.id === beam)!;
        assert(data.nodes.some((node) => node.id === member.startNodeId));
        assert(data.sections.some((section) => section.id === member.sectionId));
        assert.deepEqual(data.panels![0].propertySets?.find((set) => set.name === "Unfamiliar Pset")?.properties[1].value, [1.25, 1.5]);
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
        const result = convertIfcToCommonData(fixture(), "sample.ifc", { calculateSectionProfiles: true });
        const data = result.data;
        assert.deepEqual(result.counts, { panels: 1, legs: 3, bracingMembers: 3, nodes: 6 });
        assert.equal(data.source.format, "IFC");
        assert.equal(data.panels![0].legs.length, 3);
        assert.equal(data.panels![0].faces.length, 3);
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
        assert.equal(result.data.panels!.length, 1);
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

    it("includes section contours only when requested, preserving dimensions and member references", () => {
        const ifc = fixture();
        const normal = convertIfcToCommonData(ifc, "sample.ifc");
        const calculated = convertIfcToCommonData(ifc, "sample.ifc", { calculateSectionProfiles: true });
        assert(normal.data.sections.length > 0);
        assert(normal.data.sections.every((section) => section.contour === undefined));
        assert(calculated.data.sections.some((section) => section.contour && section.contour.length === 6));
        assert.deepEqual(normal.data.sections, calculated.data.sections.map(({ contour, ...section }) => section));
        assert.deepEqual(normal.data.members, calculated.data.members);
        assert.deepEqual(normal.data.nodes, calculated.data.nodes);
        assert(normal.warnings.some((warning) => warning.includes("contour output is disabled")));
        assert(!normal.warnings.some((warning) => warning.includes("outer contour vertices")));
        assert(calculated.warnings.some((warning) => warning.includes("outer contour vertices")));
    });

    it("combines profile calculation with partial and compact CLI options in either order", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifc-profiles-"));
        const input = path.join(directory, "input.ifc");
        const first = path.join(directory, "first.json");
        const second = path.join(directory, "second.json");
        try {
            fs.writeFileSync(input, fixture().replace(/('No\. of Panels',\$,IFCTEXT\()'1'/, "$1'46'"));
            assert.throws(() => convertIfcToCommonDataFiles([input, first, "--calculateSectionProfiles"]), /declares 46 panels/);
            convertIfcToCommonDataFiles([input, first, "--allowPartial", "--calculateSectionProfiles", "--compact"]);
            convertIfcToCommonDataFiles([input, second, "--compact", "--calculateSectionProfiles", "--allow-partial"]);
            const data = JSON.parse(fs.readFileSync(first, "utf8"));
            assert.deepEqual(data, JSON.parse(fs.readFileSync(second, "utf8")));
            assert.equal(data.towerInformation.partialExport, true);
            assert(data.sections.some((section: { contour?: unknown[] }) => section.contour?.length === 6));
            assert.equal(data.projectData.propertySets, undefined);
            assert.throws(() => convertIfcToCommonDataFiles([input, first, "--allowPartial", "--allow-partial"]), /Usage/);
            assert.throws(() => convertIfcToCommonDataFiles([input, first, "--calculateSectionProfiles", "--calculateSectionProfiles"]), /Usage/);
        } finally {
            for (const file of [input, first, second]) if (fs.existsSync(file)) fs.unlinkSync(file);
            fs.rmdirSync(directory);
        }
    });

    it("omits property sets throughout compact JSON without changing other data", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ifc-compact-"));
        const input = path.join(directory, "input.ifc");
        const normal = path.join(directory, "normal.json");
        const compact = path.join(directory, "compact.json");
        const compactReversed = path.join(directory, "compact-reversed.json");
        try {
            fs.writeFileSync(input, fixture("solid").replace(/('No\. of Panels',\$,IFCTEXT\()'1'/, "$1'46'"));
            convertIfcToCommonDataFiles([input, normal, "--allow-partial"]);
            convertIfcToCommonDataFiles([input, compact, "--compact", "--allow-partial"]);
            convertIfcToCommonDataFiles([input, compactReversed, "--allow-partial", "--compact"]);
            const full = fs.readFileSync(normal, "utf8");
            const parsed = JSON.parse(full);
            assert(parsed.projectData.propertySets.length);
            assert(parsed.panels[0].faceBracingPropertySets.length);
            assert(parsed.panels[0].faces[0].segments[0].propertySets.length);
            const expected = JSON.parse(JSON.stringify(parsed, (key, value: unknown) =>
                key === "propertySets" || key === "faceBracingPropertySets" ? undefined : value));
            assert.deepEqual(JSON.parse(fs.readFileSync(compact, "utf8")), expected);
            assert.deepEqual(JSON.parse(fs.readFileSync(compactReversed, "utf8")), expected);
            assert.throws(() => convertIfcToCommonDataFiles([input, compact, "--compact", "--allow-partial"]), /EEXIST/);
            assert.throws(() => convertIfcToCommonDataFiles([input, compact, "--compact", "--compact"]), /Usage/);
            assert.throws(() => convertIfcToCommonDataFiles([input, compact, "--unknown"]), /Usage/);
            assert.throws(() => convertIfcToCommonDataFiles([input, compact, "--compact", "--unknown"]), /Usage/);
        } finally {
            for (const file of [input, normal, compact, compactReversed]) if (fs.existsSync(file)) fs.unlinkSync(file);
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
