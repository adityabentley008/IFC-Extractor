import { Element } from "xml-js";
import { IfcModel } from "../IfcModel";
import { IfcEntity, ProfileShape } from "../IfcTypes";
import { recoverProfile, spatialEndpoint } from "../geometry/ProfileRecovery";
import { finite, stepText } from "../StepParser";
import { element } from "./Xml";
import { Section } from "../../CommonData";

export class Sections {
    public readonly data: Section[] = [];
    private readonly ids = new Map<string, string>();
    private readonly namedKeys = new Map<string, string>();
    private readonly definitions: IfcEntity[];

    public get elements(): Element[] {
        return this.data.reduce<Element[]>((all, section) => all.concat([
            element("Section", section.sourceAttributes),
            ...(section.contour || []).map((p) => element("PolyLine", {
                RefID: section.id, PolygonID: p.polygonId, X: String(p.x), Y: String(p.y), Z: String(p.z),
            })),
        ]), []);
    }

    constructor(private readonly model: IfcModel, private readonly convention: string,
        private readonly beams: IfcEntity[], private readonly warnings: string[]) {
        this.definitions = model.entitiesOfType("IFCBUILDINGELEMENTPROXY").filter((entity) => entity.args[3]?.startsWith("'") &&
            ["[OpenTower].[HollowCircle]", "[OpenTower].[LShape]"].includes(stepText(entity.args[3])));
    }

    public resolve(name: string, beam: IfcEntity): string {
        const parametric = this.convention === "OpenTower";
        const previous = !parametric && this.ids.get(name);
        if (previous) return previous;
        const generic = parametric && ["HollowCircleProfile", "LShapeProfile"].includes(name);
        const profiles = generic ? [] : this.definitions.filter((entity) => stepText(entity.args[2]) === name);
        if (!generic && profiles.length !== 1) throw new Error(`Expected one supported IFC profile definition for ${name}.`);
        const shape: ProfileShape = generic
            ? name === "HollowCircleProfile" ? "HollowCircleProfile" : "LShapeProfile"
            : stepText(profiles[0].args[3]) === "[OpenTower].[HollowCircle]" ? "HollowCircleProfile" : "LShapeProfile";
        const candidates = parametric ? [beam] : this.beams.filter((entity) =>
            (this.model.property(entity.id, "Section Name") || this.model.property(entity.id, "Section")) === name,
        ).sort((a, b) => a.id - b.id);
        const representative = parametric ? beam : candidates.find((candidate) => this.isVertical(candidate)) || candidates[0];
        if (!parametric && shape === "HollowCircleProfile" && !this.isVertical(representative)) {
            throw new Error(`Section ${name} needs a vertical representative to recover the connector's hollow-circle wall thickness.`);
        }
        const recovered = recoverProfile(representative, this.model.getEntity,
            spatialEndpoint(this.model.required(representative.id, "StartPoint")),
            spatialEndpoint(this.model.required(representative.id, "EndPoint")),
            finite(this.model.required(representative.id, "BetaAngle"), "BetaAngle"), shape, parametric);
        if (parametric && !generic && shape === "HollowCircleProfile") {
            const wall = this.model.property(profiles[0].id, "WallThickness");
            if (wall !== undefined) {
                if (finite(wall, `${name}.WallThickness`) < 0) throw new Error(`Invalid wall thickness for ${name}.`);
                recovered.dimensions.WallThickness = wall;
            }
        }
        const key = parametric ? JSON.stringify([name, Object.values(recovered.dimensions).map((value) => Number(value).toFixed(5))]) : name;
        if (parametric && !generic) {
            const namedKey = this.namedKeys.get(name);
            if (namedKey && namedKey !== key) throw new Error(`Conflicting member dimensions for named section ${name}.`);
            this.namedKeys.set(name, key);
        }
        const existing = this.ids.get(key);
        if (existing) return existing;
        const id = String(this.ids.size + 1);
        const sectionName = generic ? `${name}_IFC_${beam.id}` : name;
        const sourceAttributes = { ID: id, Name: shape, SectionName: sectionName, ...recovered.dimensions };
        const dimensions: Record<string, number> = {};
        for (const [dimension, value] of Object.entries(recovered.dimensions)) dimensions[dimension] = finite(value, `${sectionName}.${dimension}`);
        const section: Section = { id, shape, name: sectionName, dimensions, sourceAttributes };
        if (recovered.contour.length) section.contour = recovered.contour.map((point) =>
            ({ polygonId: "1", x: point.x, y: 0, z: point.z }));
        this.data.push(section);
        this.warnings.push(`Recovered ${sectionName} from IFC beam #${representative.id}: ${parametric ? "parametric dimensions" : `${recovered.contour.length} outer contour vertices`}.`);
        this.ids.set(key, id);
        return id;
    }

    private isVertical(beam: IfcEntity): boolean {
        const start = spatialEndpoint(this.model.required(beam.id, "StartPoint"));
        const end = spatialEndpoint(this.model.required(beam.id, "EndPoint"));
        return Math.hypot(start.x - end.x, start.y - end.y) < 1e-8;
    }
}
