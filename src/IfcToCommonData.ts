import { CommonData, Face, Member, MemberGroup, Panel, ProjectData, SourceProperties, TowerInformation } from "./CommonData";
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

function propertySets(model: IfcModel, id: number): SourceProperties {
    const sets = model.sourcePropertySets(id);
    return sets.length ? { propertySets: sets } : {};
}

class PanelHierarchy {
    public readonly members: Member[] = [];
    public readonly memberIds = new Set<number>();
    public nonPanelMemberCount = 0;

    constructor(private readonly model: IfcModel, private readonly builder: PhysicalMemberBuilder,
        private readonly roots: Set<number>) {}

    public addMember(entity: IfcEntity, panelId: string): string {
        const member = this.builder.buildData(entity, panelId, true);
        Object.assign(member, propertySets(this.model, entity.id));
        const childGroups = this.extraGroups(entity.id, panelId);
        if (childGroups.length) member.memberGroups = childGroups;
        this.memberIds.add(entity.id);
        if (!panelId) this.nonPanelMemberCount++;
        this.members.push(member);
        return member.id;
    }

    public extraGroups(parentId: number, panelId: string, mapped: readonly IfcEntity[] = []): MemberGroup[] {
        const excluded = new Set(mapped.map((entity) => entity.id));
        return this.model.childrenOf(parentId)
            .filter((child) => !excluded.has(child.id) && !this.roots.has(child.id))
            .map((child) => this.group(child, panelId));
    }

    public group(entity: IfcEntity, panelId: string, mapped: readonly IfcEntity[] = []): MemberGroup {
        const model = this.model;
        const source = propertySets(model, entity.id);
        const textProperty = (name: string): string | undefined => {
            const values = new Set<string>();
            for (const set of source.propertySets ?? []) for (const prop of set.properties) {
                if (prop.name === name && typeof prop.value === "string") values.add(prop.value);
            }
            return model.property(entity.id, name) ?? (values.size === 1 ? values.values().next().value : undefined);
        };
        const type = textProperty("ComponentName") || entity.type;
        const label = textProperty("User Label") ||
            (entity.args[2] && entity.args[2] !== "$" ? stepText(entity.args[2]) : type);
        const code = textProperty("Code");
        const result: MemberGroup = { id: String(entity.id), type, label, members: [], ...source };
        if (code !== undefined) result.sourceAttributes = { Code: code };
        if (this.isMember(entity)) {
            result.members.push(this.addMember(entity, panelId));
            return result;
        }
        const mappedIds = new Set(mapped.map((child) => child.id));
        for (const child of model.childrenOf(entity.id)) {
            if (this.roots.has(child.id) || mappedIds.has(child.id)) continue;
            if (this.isMember(child)) {
                result.members.push(this.addMember(child, panelId));
            } else {
                (result.memberGroups ??= []).push(this.group(child, panelId));
            }
        }
        return result;
    }

    private isMember(entity: IfcEntity): boolean {
        return entity.type === "IFCBEAM" || entity.type === "IFCMEMBER" ||
            (this.model.property(entity.id, "StartPoint") !== undefined && this.model.property(entity.id, "EndPoint") !== undefined);
    }
}

function panelData(model: IfcModel, hierarchy: PanelHierarchy, panel: IfcEntity, tower: IfcEntity): Panel {
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
    const add = (entity: IfcEntity): string => hierarchy.addMember(entity, id);
    const legData = legs.map((leg, index) => ({ name: legNames[index], members: [add(leg)] }));
    const faceData: Face[] = faces.map((face, index) => {
        const segments = model.children(face.id, "Segment");
        if (segments.length !== segmentCount) throw new Error(`Segment count mismatch at #${face.id}.`);
        const faceGroups = hierarchy.extraGroups(face.id, id, segments);
        return { id: String(index + 1), name: names[index], ...propertySets(model, face.id),
            ...(faceGroups.length ? { memberGroups: faceGroups } : {}),
            segments: segments.map((segment, i) => {
                const beams = model.children(segment.id, "TowerMember");
                const memberGroups = hierarchy.extraGroups(segment.id, id, beams);
                return { id: String(i + 1), name: model.required(segment.id, "Name"), members: beams.map(add),
                    ...propertySets(model, segment.id), ...(memberGroups.length ? { memberGroups } : {}) };
            }),
        };
    });
    const memberGroups = hierarchy.extraGroups(panel.id, id, [...legs, ...groups]);
    const otherFaceChildren = hierarchy.group(groups[0], id, faces);
    if (otherFaceChildren.members.length || otherFaceChildren.memberGroups?.length) memberGroups.push(otherFaceChildren);
    return {
        id, label: stepText(panel.args[2]), height: num("Height of Panel"),
        topWidth: num("Top Width of Panel"), bottomWidth: num("Bottom  Width of Panel"),
        topElevation: num("Top Elevation of Panel"), bottomElevation: num("Bottom Elevation of Panel"),
        faceBracing: str("Face Bracing of Panel"), planBracing: model.property(panel.id, "Plan Bracing of Panel") ?? "",
        hipBracing: model.property(panel.id, "Hip Bracing of Panel") ?? "", numberOfSegments: segmentCount, weight: num("Weight of Panel"),
        legs: legData, faces: faceData,
        ...propertySets(model, panel.id), faceBracingPropertySets: otherFaceChildren.propertySets,
        ...(memberGroups.length ? { memberGroups } : {}),
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
    const model = new IfcModel(ifc, true);
    const tower = readTower(model, options.allowPartial, true);
    const warnings = conversionWarnings(tower);
    warnings[0] = "Common X preserves tower and site components connected by IFC nesting or aggregation; only supported geometry is normalized.";
    const builder = new PhysicalMemberBuilder(model, tower.convention, tower.beams, warnings);

    const sites = model.entitiesOfType("IFCSITE");
    if (sites.length !== 1) throw new Error("Expected one IFC site with Site_Data geolocation.");
    const hierarchy = new PanelHierarchy(model, builder, new Set([sites[0].id, tower.entity.id, ...tower.panels.map((panel) => panel.id)]));
    const panels = tower.panels.map((panel) => panelData(model, hierarchy, panel, tower.entity));
    const siteGroups = hierarchy.extraGroups(sites[0].id, "");
    const towerGroups = hierarchy.extraGroups(tower.entity.id, "");
    const { members } = hierarchy;
    builder.finish(false);
    const outsideScope = tower.beams.filter((beam) => !hierarchy.memberIds.has(beam.id));
    if (outsideScope.length) warnings.push(`${outsideScope.length} IFC beams have no nesting or aggregation path to the exported site, tower or panels.`);
    const incomplete = members.filter((member) => member.extractionIssues?.length).length;
    if (incomplete) warnings.push(`${incomplete} members have incomplete normalization; see their extractionIssues. Membership and available properties were retained.`);
    const locationValue = (name: string) => finite(model.required(sites[0].id, name), name);
    const projectData: ProjectData = {
        projectId: "1",
        ...propertySets(model, sites[0].id), ...(siteGroups.length ? { memberGroups: siteGroups } : {}),
        location: { latitudeDegrees: locationValue("Latitude"), longitudeDegrees: locationValue("Longitude"), altitudeMetres: locationValue("Altitude") },
        sourceAttributes: { ComponentName: "ProjectData", SourceAppElementId: "ProjectData_1",
            Site_Lattitude: model.required(sites[0].id, "Latitude"), Site_Longitude: model.required(sites[0].id, "Longitude"),
            Site_Altitude: model.required(sites[0].id, "Altitude") },
    };
    const towerId = tower.entity.id;
    const towerText = (key: string) => model.required(towerId, key);
    const towerNumber = (key: string) => finite(towerText(key), key);
    const information: TowerInformation = {
        ...propertySets(model, towerId), ...(towerGroups.length ? { memberGroups: towerGroups } : {}),
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
        schemaVersion: "1.1-draft",
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
    const legs = panels.reduce((count, panel) => count + panel.legs.length, 0);
    return { data, warnings, counts: {
        panels: panels.length, legs,
        bracingMembers: members.length - legs - hierarchy.nonPanelMemberCount,
        nodes: builder.nodes.data.length,
    } };
}
