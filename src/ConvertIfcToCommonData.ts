#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { convertIfcToCommonData } from "./IfcToCommonData";

export function convertIfcToCommonDataFiles(args: string[]): void {
    const [input, output] = args;
    if ((args.length !== 2 && !(args.length === 3 && args[2] === "--allow-partial")) ||
        !input || !output || input.startsWith("--") || output.startsWith("--")) {
        throw new Error("Usage: ifc-to-common input.ifc output.json [--allow-partial]");
    }
    if (path.resolve(input).toLowerCase() === path.resolve(output).toLowerCase()) throw new Error("Output must not overwrite an input file.");
    const result = convertIfcToCommonData(fs.readFileSync(input, "utf8"), path.basename(input), { allowPartial: args[2] === "--allow-partial" });
    for (const warning of result.warnings) console.warn(`IFC conversion warning: ${warning}`);
    fs.writeFileSync(output, `${JSON.stringify(result.data, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(`Created ${output}: ${JSON.stringify(result.counts)}`);
}

if (require.main === module) {
    try {
        convertIfcToCommonDataFiles(process.argv.slice(2));
    } catch (error) {
        console.error("IFC conversion failed:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
