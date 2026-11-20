import { IfcEntity } from "./IfcTypes";

export function splitStep(text: string, separator: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let depth = 0;
    let quoted = false;
    let comment = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (comment) {
            if (ch === "*" && text[i + 1] === "/") {
                comment = false;
                i++;
            }
            continue;
        }
        if (!quoted && ch === "/" && text[i + 1] === "*") {
            comment = true;
            i++;
            continue;
        }
        if (ch === "'") {
            if (quoted && text[i + 1] === "'") {
                i++;
            } else {
                quoted = !quoted;
            }
        } else if (!quoted) {
            if (ch === "(") depth++;
            if (ch === ")") depth--;
            if (depth < 0) throw new Error("Unbalanced STEP parentheses.");
            if (depth === 0 && ch === separator) {
                parts.push(text.slice(start, i).trim());
                start = i + 1;
            }
        }
    }
    if (quoted || comment || depth !== 0) throw new Error("Unterminated STEP value.");
    if (text.slice(start).trim()) parts.push(text.slice(start).trim());
    return parts;
}

export function stepText(raw: string): string {
    const wrapped = /^IFC[A-Z0-9_]+\(([\s\S]*)\)$/.exec(raw);
    if (wrapped) return stepText(wrapped[1]);
    if (raw.startsWith("'") && raw.endsWith("'")) {
        const text = raw.slice(1, -1).replace(/''/g, "'");
        const decoded = text.replace(/\\X([24])\\([0-9a-fA-F]+)\\X0\\/g, (_match, size: string, hex: string) => {
            const width = Number(size) * 2;
            if (hex.length % width !== 0) throw new Error("Invalid STEP Unicode string.");
            const codes: number[] = [];
            for (let i = 0; i < hex.length; i += width) codes.push(parseInt(hex.slice(i, i + width), 16));
            return size === "2" ? String.fromCharCode(...codes) : String.fromCodePoint(...codes);
        });
        if (decoded.includes("\\")) throw new Error("Unsupported STEP string escape.");
        return decoded;
    }
    if (raw === "$" || raw === "*") throw new Error("Required IFC value is unset.");
    return raw;
}

export function references(raw: string): number[] {
    return splitStep(raw.replace(/^\(([\s\S]*)\)$/, "$1"), ",").map((ref) => {
        if (!/^#\d+$/.test(ref)) throw new Error(`Invalid IFC reference: ${ref}`);
        return Number(ref.slice(1));
    });
}

export function finite(value: string, context: string): number {
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`Invalid number for ${context}: ${value}`);
    return Number(value);
}

export function parseIfcEntities(ifc: string, retainAll = false): Map<number, IfcEntity> {
    if (!/END-ISO-10303-21;\s*$/.test(ifc)) throw new Error("Incomplete IFC STEP document.");
    const entities = new Map<number, IfcEntity>();
    let schema = false;
    let exporter = false;
    const retained = new Set([
        "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCBEAM", "IFCSPACE", "IFCWALL", "IFCWINDOW",
        "IFCBUILDINGELEMENTPART", "IFCBUILDINGELEMENTPROXY", "IFCFOOTING", "IFCSITE",
        "IFCPROJECT", "IFCPROPERTYSINGLEVALUE", "IFCPROPERTYSET", "IFCRELDEFINESBYPROPERTIES",
        "IFCRELNESTS", "IFCSIUNIT", "IFCCONVERSIONBASEDUNIT", "IFCUNITASSIGNMENT",
        "IFCPRODUCTDEFINITIONSHAPE", "IFCSHAPEREPRESENTATION", "IFCMAPPEDITEM", "IFCREPRESENTATIONMAP",
        "IFCCARTESIANTRANSFORMATIONOPERATOR3D", "IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM",
        "IFCFACETEDBREP", "IFCCLOSEDSHELL", "IFCFACE", "IFCFACEOUTERBOUND", "IFCFACEBOUND", "IFCPOLYLOOP",
        "IFCCARTESIANPOINT", "IFCDIRECTION", "IFCAXIS2PLACEMENT3D", "IFCLOCALPLACEMENT",
    ]);
    for (const statement of splitStep(ifc, ";")) {
        // Strip comments without changing comment-like text inside quoted strings.
        const cleaned = statement.replace(/'(?:''|[^'])*'|\/\*[\s\S]*?\*\//g, (token) => token.startsWith("'") ? token : "");
        if (/^FILE_SCHEMA\s*\(\s*\(\s*'IFC2X3'\s*\)\s*\)$/i.test(cleaned.trim())) schema = true;
        const match = /^\s*#(\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*\(([\s\S]*)\)\s*$/.exec(cleaned);
        if (!match) {
            if (cleaned.trim().startsWith("#")) throw new Error("Malformed IFC entity.");
            continue;
        }
        if (match[2] === "IFCAPPLICATION" && match[3].includes("'iModel2IFC'")) exporter = true;
        if (!retainAll && !retained.has(match[2])) continue;
        const id = Number(match[1]);
        if (entities.has(id)) throw new Error(`Duplicate IFC entity #${id}.`);
        entities.set(id, { id, type: match[2], args: splitStep(match[3], ",") });
    }
    if (!schema || !exporter) throw new Error("Only Bentley iModel OpenTower IFC2X3 exports are supported.");
    return entities;
}
