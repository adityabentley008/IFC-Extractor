import { CommonData, Face, Member, Panel, ProjectData, TowerInformation } from "./CommonData";
import { IfcModel } from "./ifc/IfcModel";
import { IfcEntity } from "./ifc/IfcTypes";
import { finite, stepText } from "./ifc/StepParser";
import { PhysicalMemberBuilder } from "./ifc/otxml/PhysicalMember";
import { conversionWarnings, readTower } from "./ifc/otxml/Tower";

export * from "./CommonData";

export interface IfcToCommonDataResult {
    data: CommonData;
    warnings: string[];
    counts: { panels: number; legs: number; bracingMembers: number; nodes: number };
}

function panelData(model: IfcModel, builder: PhysicalMemberBuilder, panel: IfcEntity, tower: IfcEntity, members: Member[]): Panel {
    const id = model.required(panel.id, "PanelID");
    const str = (key: string) => model.required(panel.id, key);
    const num = (key: string) => finite(str(key), `Panel ${id}.${key}`);
    const legs = model.children(panel.id, "Leg");
    if (legs.length !== finite(model.required(tower.id, "No. of Legs"), "leg count")) throw new Error(`Leg count mismatch in panel ${id}.`);
    const legNames = legs.map((leg) => model.required(leg.id, "Leg Name"));
    if (new Set(legNames).size !== legNames.length) throw new Error(`Duplicate leg name in panel ${id}.`);
    const groups = model.children(panel.id, "FaceBracing");
    if (groups.length !== 1) throw new Error(`Expected one FaceBracing group in panel ${id}.`);
    const faces = model.children(groups[0].id, "Face");
    const names = faces.map((face) => model.required(face.id, "FaceName"));
    if (faces.length !== legs.length || new Set(names).size !== faces.length) throw new Error(`Invalid face hierarchy in panel ${id}.`);
    const segmentCount = num("Number Of Segments in Panel");
    const add = (entity: IfcEntity): string => {
        const member = builder.buildData(entity, id);
        members.push(member);
        return member.id;
    };
    const legData = legs.map((leg, index) => ({ name: legNames[index], members: [add(leg)] }));
    const faceData: Face[] = faces.map((face, index) => {
        const segments = model.children(face.id, "Segment");
        if (segments.length !== segmentCount) throw new Error(`Segment count mismatch at #${face.id}.`);
        return { id: String(index + 1), name: names[index], segments: segments.map((segment, i) => ({
            id: String(i + 1), name: model.required(segment.id, "Name"),
            members: model.children(segment.id, "TowerMember").map(add),
        })) };
    });
    return {
        id, label: stepText(panel.args[2]), height: num("Height of Panel"),
        topWidth: num("Top Width of Panel"), bottomWidth: num("Bottom  Width of Panel"),
        topElevation: num("Top Elevation of Panel"), bottomElevation: num("Bottom Elevation of Panel"),
        faceBracing: str("Face Bracing of Panel"), planBracing: str("Plan Bracing of Panel"),
        hipBracing: str("Hip Bracing of Panel"), numberOfSegments: segmentCount, weight: num("Weight of Panel"),
        legs: legData, faces: faceData,
        sourceAttributes: { panelProperty: {
            ComponentName: "Panel", SourceAppElementId: `Panel_${id}`,
            Height: str("Height of Panel"), TopWidth: str("Top Width of Panel"), BottomWidth: str("Bottom  Width of Panel"),
            TopElevation: str("Top Elevation of Panel"), BottomElevation: str("Bottom Elevation of Panel"),
            NumberOfSegments: str("Number Of Segments in Panel"), Weight: str("Weight of Panel"),
        } },
    };
}

export function convertIfcToCommonData(ifc: string, fileName: string, options: { allowPartial?: boolean } = {}): IfcToCommonDataResult {
    if (!fileName) throw new Error("An IFC source file name is required.");
    const model = new IfcModel(ifc);
    const tower = readTower(model, options.allowPartial);
    const warnings = conversionWarnings(tower);
    const builder = new PhysicalMemberBuilder(model, tower.convention, tower.beams, warnings);
    const members: Member[] = [];
    const panels = tower.panels.map((panel) => panelData(model, builder, panel, tower.entity, members));
    builder.finish();

    const sites = model.entitiesOfType("IFCSITE");
    if (sites.length !== 1) throw new Error("Expected one IFC site with Site_Data geolocation.");
    const locationValue = (name: string) => finite(model.required(sites[0].id, name), name);
    const projectData: ProjectData = {
        projectId: "1",
        location: { latitudeDegrees: locationValue("Latitude"), longitudeDegrees: locationValue("Longitude"), altitudeMetres: locationValue("Altitude") },
        sourceAttributes: { ComponentName: "ProjectData", SourceAppElementId: "ProjectData_1",
            Site_Lattitude: model.required(sites[0].id, "Latitude"), Site_Longitude: model.required(sites[0].id, "Longitude"),
            Site_Altitude: model.required(sites[0].id, "Altitude") },
    };
    const towerId = tower.entity.id;
    const towerText = (key: string) => model.required(towerId, key);
    const towerNumber = (key: string) => finite(towerText(key), key);
    const information: TowerInformation = {
        id: towerText("Tower ID"), name: towerText("Tower Name"), type: towerText("Tower Type"),
        height: towerNumber("Height of Tower"), numberOfLegs: towerNumber("No. of Legs"),
        declaredPanelCount: tower.declaredPanels, bearingAngleDegrees: towerNumber("Bearing Angle/ North Orientation"),
        topFaceWidth: towerNumber("Top Face Width (ft)"), topFaceDepth: towerNumber("Top Face Depth (ft)"),
        bottomFaceWidth: towerNumber("Bottom Face Width (ft)"), bottomFaceDepth: towerNumber("Bottom Face Depth (ft)"),
        convention: tower.convention, unitSystem: towerText("Unit System"), otxmlAngle: towerNumber("OTXMLAngle"),
        orientation: towerText("Orientation"),
        sourceAttributes: { ComponentName: "TowerInformation", SourceAppElementId: "TowerInformation_1",
            OTXMLAngle: towerText("OTXMLAngle") },
    };
    for (const [source, target] of [
        ["ConcreteHeight", "concreteHeight"], ["Tower Tilt X", "tiltX"], ["Tower Tilt Y", "tiltY"],
    ] as Array<[string, "concreteHeight" | "tiltX" | "tiltY"]>) {
        const value = model.property(towerId, source);
        if (value !== undefined) information[target] = finite(value, source);
    }
    const towerShape = model.property(towerId, "TowerShape");
    if (towerShape !== undefined) information.towerShape = towerShape;
    if (panels.length !== tower.declaredPanels) information.partialExport = true;
    const data: CommonData = {
        schemaVersion: "1.0-draft",
        source: { format: "IFC", fileName },
        units: {
            nodeCoordinates: { unit: "m", basis: "OpenTower endpoint properties" },
            panelDimensions: { unit: "ft", basis: "OpenTower panel properties" },
            towerDimensions: { unit: "ft", basis: "OpenTower tower properties" },
            sectionDimensions: { unit: "in", basis: "legacy connector profile convention" },
            panelWeight: { unit: "unknown" },
        },
        coordinateSystem: { upAxis: "Y", basis: "OpenTower endpoint properties" },
        projectData, towerInformation: information, panels, nodes: builder.nodes.data, members,
        sections: builder.sections.data, materials: builder.materials.data,
        notes: [...warnings, "projectData.projectId and some source element identifiers are generated for connector compatibility; they are not original source IDs."],
    };
    return { data, warnings, counts: {
        panels: panels.length, legs: model.components("Leg").length,
        bracingMembers: model.components("TowerMember").length, nodes: builder.nodes.data.length,
    } };
}
