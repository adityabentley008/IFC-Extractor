import { PropertyValue, SourceProperty, SourcePropertySet } from "../CommonData";
import { IfcEntity } from "./IfcTypes";
import { references, splitStep, stepText } from "./StepParser";

type Lookup = (id: number) => IfcEntity;

function value(raw: string): PropertyValue {
    if (raw === "$" || raw === "*") return null;
    const wrapped = /^IFC[A-Z0-9_]+\(([\s\S]*)\)$/.exec(raw);
    if (wrapped) return value(wrapped[1]);
    if (raw.startsWith("(") && raw.endsWith(")")) return splitStep(raw.slice(1, -1), ",").map(value);
    if (raw === ".T." || raw === ".F.") return raw === ".T.";
    if (raw.startsWith("'")) return stepText(raw);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:E[+-]?\d+)?$/i.test(raw)) {
        const number = Number(raw);
        if (Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number))) return number;
    }
    return raw;
}

function readProperty(prop: IfcEntity, lookup: Lookup, ancestors: Set<number>): SourceProperty {
    const quantity = prop.type.startsWith("IFCQUANTITY");
    const result: SourceProperty = { name: stepText(prop.args[0]), type: prop.type };
    if (ancestors.has(prop.id)) throw new Error(`Cyclic IFC property at #${prop.id}.`);
    if (prop.type === "IFCCOMPLEXPROPERTY" || prop.type === "IFCPHYSICALCOMPLEXQUANTITY") {
        ancestors.add(prop.id);
        result.properties = references(prop.args[prop.type === "IFCCOMPLEXPROPERTY" ? 3 : 2])
            .map((id) => readProperty(lookup(id), lookup, ancestors));
        ancestors.delete(prop.id);
    } else {
        if (quantity || prop.type === "IFCPROPERTYSINGLEVALUE" || prop.type === "IFCPROPERTYLISTVALUE") {
            result.value = value(prop.args[quantity ? 3 : 2]);
            const unit = prop.args[quantity ? 2 : 3];
            if (unit?.startsWith("#")) result.unitRef = unit;
        } else if (prop.type === "IFCPROPERTYENUMERATEDVALUE") {
            result.value = value(prop.args[2]);
        } else {
            result.value = prop.args.slice(2).map(value);
        }
    }
    return result;
}

export function readPropertySet(set: IfcEntity, lookup: Lookup): SourcePropertySet {
    const name = set.args[2] && set.args[2] !== "$" ? stepText(set.args[2]) : set.type;
    if (set.type !== "IFCPROPERTYSET" && set.type !== "IFCELEMENTQUANTITY") {
        return { name, properties: [{ name, type: set.type, value: set.args.slice(4).map(value) }] };
    }
    const ancestors = new Set<number>();
    return { name, properties: references(set.args[set.type === "IFCPROPERTYSET" ? 4 : 5])
        .map((id) => readProperty(lookup(id), lookup, ancestors)) };
}
