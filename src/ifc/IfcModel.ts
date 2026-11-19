import { IfcEntity, Properties } from "./IfcTypes";
import { parseIfcEntities, references, stepText } from "./StepParser";

export class IfcModel {
    private readonly entities: Map<number, IfcEntity>;
    private readonly properties = new Map<number, Properties>();
    private readonly parents = new Map<number, number>();

    constructor(ifc: string) {
        this.entities = parseIfcEntities(ifc);
        for (const entity of this.entities.values()) {
            if (entity.type === "IFCRELDEFINESBYPROPERTIES") this.attachProperties(entity);
            else if (entity.type === "IFCRELNESTS") this.attachChildren(entity);
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
        return this.components(component).filter((entity) => this.parents.get(entity.id) === parentId);
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
        const set = this.getEntity(references(relation.args[5])[0], "IFCPROPERTYSET");
        const setName = stepText(set.args[2]);
        if (!setName.startsWith("[OpenTower].") && setName !== "Site_Data") return;
        for (const target of references(relation.args[4])) {
            this.getEntity(target);
            const values = this.properties.get(target) || {};
            for (const ref of references(set.args[4])) {
                const prop = this.getEntity(ref, "IFCPROPERTYSINGLEVALUE");
                if (prop.args[2] === "$") continue;
                if (prop.args[3] !== "$") throw new Error(`Property-specific units are unsupported at #${ref}.`);
                const key = stepText(prop.args[0]);
                const value = stepText(prop.args[2]);
                if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== value) {
                    throw new Error(`Conflicting property ${key} on #${target}.`);
                }
                Object.defineProperty(values, key, { value, enumerable: true, configurable: true });
            }
            this.properties.set(target, values);
        }
    }

    private attachChildren(relation: IfcEntity): void {
        const parent = references(relation.args[4])[0];
        this.getEntity(parent);
        for (const child of references(relation.args[5])) {
            this.getEntity(child);
            if (this.parents.has(child) && this.parents.get(child) !== parent) throw new Error(`Multiple parents for #${child}.`);
            this.parents.set(child, parent);
        }
    }
}
