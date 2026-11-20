import { IfcEntity, Properties } from "./IfcTypes";
import { parseIfcEntities, references, stepText } from "./StepParser";
import { SourcePropertySet } from "../CommonData";
import { readPropertySet } from "./SourceProperties";

export class IfcModel {
    private readonly entities: Map<number, IfcEntity>;
    private readonly properties = new Map<number, Properties>();
    private readonly conflictingProperties = new Map<number, Set<string>>();
    private readonly parents = new Map<number, number>();
    private readonly nested = new Map<number, IfcEntity[]>();
    private readonly propertyDefinitions = new Map<number, number[]>();

    constructor(ifc: string, private readonly extract = false) {
        this.entities = parseIfcEntities(ifc, extract);
        for (const entity of this.entities.values()) {
            if (entity.type === "IFCRELDEFINESBYPROPERTIES") this.attachProperties(entity);
            else if (entity.type === "IFCRELNESTS") this.attachChildren(entity);
        }
        if (extract) for (const entity of this.entities.values()) {
            if (entity.type === "IFCRELAGGREGATES") this.attachChildren(entity, true);
        }
    }

    public getEntity = (id: number, type?: string): IfcEntity => {
        const found = this.entities.get(id);
        if (!found || (type && found.type !== type)) throw new Error(`Missing or invalid ${type || "entity"} #${id}.`);
        return found;
    };

    public entitiesOfType(type: string): IfcEntity[] {
        return [...this.entities.values()].filter((entity) => entity.type === type);
    }

    public property(id: number, key: string): string | undefined {
        return this.properties.get(id)?.[key];
    }

    public required(id: number, key: string): string {
        const value = this.property(id, key);
        if (value === undefined || value === "") throw new Error(`Missing ${key} on IFC #${id}.`);
        return value;
    }

    public components(component: string): IfcEntity[] {
        return [...this.entities.values()].filter((entity) => this.property(entity.id, "ComponentName") === component);
    }

    public children(parentId: number, component: string): IfcEntity[] {
        if (!this.extract) return this.components(component).filter((entity) => this.parents.get(entity.id) === parentId);
        return this.childrenOf(parentId).filter((entity) => this.property(entity.id, "ComponentName") === component);
    }

    public childrenOf(parentId: number): readonly IfcEntity[] {
        return this.nested.get(parentId) ?? [];
    }

    public sourcePropertySets(id: number): SourcePropertySet[] {
        return (this.propertyDefinitions.get(id) ?? []).map((ref) => readPropertySet(this.getEntity(ref), this.getEntity));
    }

    public ancestry(id: number): number[] {
        const path = [id];
        while (this.parents.has(id)) {
            id = this.parents.get(id)!;
            if (path.includes(id)) throw new Error(`Cyclic IFC nesting at #${id}.`);
            path.push(id);
        }
        return path;
    }

    private attachProperties(relation: IfcEntity): void {
        const set = this.getEntity(references(relation.args[5])[0], this.extract ? undefined : "IFCPROPERTYSET");
        const targets = references(relation.args[4]);
        if (this.extract) for (const target of targets) {
            const definitions = this.propertyDefinitions.get(target) ?? [];
            if (!definitions.includes(set.id)) definitions.push(set.id);
            this.propertyDefinitions.set(target, definitions);
        }
        if (set.type !== "IFCPROPERTYSET") return;
        const setName = stepText(set.args[2]);
        if (!setName.startsWith("[OpenTower].") && setName !== "Site_Data") return;
        for (const target of targets) {
            this.getEntity(target);
            const values = this.properties.get(target) || {};
            for (const ref of references(set.args[4])) {
                const prop = this.getEntity(ref, this.extract ? undefined : "IFCPROPERTYSINGLEVALUE");
                if (prop.type !== "IFCPROPERTYSINGLEVALUE") continue;
                if (prop.args[2] === "$") continue;
                if (prop.args[3] !== "$") {
                    if (this.extract) continue;
                    throw new Error(`Property-specific units are unsupported at #${ref}.`);
                }
                const key = stepText(prop.args[0]);
                const value = stepText(prop.args[2]);
                if (this.conflictingProperties.get(target)?.has(key)) continue;
                if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== value) {
                    if (this.extract) {
                        const conflicts = this.conflictingProperties.get(target) ?? new Set<string>();
                        conflicts.add(key);
                        this.conflictingProperties.set(target, conflicts);
                        delete values[key];
                        continue;
                    }
                    throw new Error(`Conflicting property ${key} on #${target}.`);
                }
                Object.defineProperty(values, key, { value, enumerable: true, configurable: true });
            }
            this.properties.set(target, values);
        }
    }

    private attachChildren(relation: IfcEntity, secondary = false): void {
        const parent = references(relation.args[4])[0];
        this.getEntity(parent);
        for (const child of references(relation.args[5])) {
            const entity = this.getEntity(child);
            if (this.parents.has(child)) {
                if (this.parents.get(child) === parent || secondary) continue;
                throw new Error(`Multiple parents for #${child}.`);
            }
            this.parents.set(child, parent);
            const children = this.nested.get(parent) ?? [];
            children.push(entity);
            this.nested.set(parent, children);
        }
    }
}
