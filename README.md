# IFC to OTXML

Standalone TypeScript package for reconstructing SST tower-panel OTXML from
Bentley iModel OpenTower IFC2X3 exports. Supports `MS TOWER` and `OpenTower`
conventions for `SelfSupported` towers.

**The IFC is the only input file.** No original OTXML, section catalog, EC schema,
iModel credentials, connector installation, or connector source imports are
required. The package produces OTXML; it does not create an iModel.

## IFC to common data X

The IFC reader can also produce versioned common-data JSON directly, without
generating or parsing OTXML. The independent OTXML generator can then consume
that JSON. For the supplied incomplete OpenTower export:

```powershell
Set-Location D:\projects\ifc-to-otxml
npm run convert:common -- "C:\data\tower.ifc" "C:\data\tower.json" --allow-partial
Set-Location D:\projects\otxml-generator
npm run generate -- "C:\data\tower.json" "C:\data\tower.otxml" --connector
```

Omit `--allow-partial` for complete exports. It permits only a smaller exported
panel count, warns, and records the source count and partial-export status;
missing panels are never synthesized. The generator requires Python with `lxml`
for XSD validation. Output paths must not already exist.

The JSON contains project and tower metadata, panel/leg/face/segment hierarchy,
members and their node/section/material references, optional section contours,
and material properties. Material properties marked `assumed` are generic
defaults, not verified engineering values. Material assignment provenance is
also recorded per member. Source attributes retain selected OTXML-compatible
metadata and numeric precision; they do not represent the complete IFC.
Existing `convert` and `convertIfcToOtxml` remain available.

TypeScript API: `convertIfcToCommonData(ifcText, fileName, { allowPartial })`
from the package root. It returns `{ data, warnings, counts }`. The
`1.0-draft` model is in [CommonData.ts](./src/CommonData.ts); the independent
generator has the same draft contract. The two copies must evolve together
until the contract is extracted into a shared package.

## Install, build, and test

Requires Node.js 18+ and npm. Run inside this folder:

```powershell
npm ci
npm run build
npm test
```

The package has its own manifest, lockfile, TypeScript configurations, dependencies,
and 11 conversion tests. It can be copied out of the connector repository and
built/tested independently. The compatible toolchain is pinned in the lockfile.
The lockfile records this project's Bentley Azure npm mirror, so fresh installs
require access and valid npm authentication to that mirror. If npm reports
`E401`, restore that authentication; if all locked packages are already cached,
`npm ci --offline` also works. Conversion itself requires no registry login.
This package does not change machine-level npm configuration.

## Convert

```powershell
npm run convert -- "C:\data\tower.ifc" "C:\data\recovered.otxml"
# Explicitly allow a known incomplete export:
npm run convert -- "C:\data\partial.ifc" "C:\data\partial.otxml" --allow-partial
```

After building, conversion can run without rebuilding:

```powershell
node .\dist\ConvertIfc.js "C:\data\tower.ifc" "C:\data\recovered.otxml"
```

The output must be a new file. Errors and warnings are printed explicitly;
conversion failures return a nonzero exit code.

Incomplete exports fail by default. `--allow-partial` converts only the exported
panels, prints a warning, records their actual `NoofPanel`, and preserves the
declared total in `SourcePanelCount` with `PartialExport="True"`. Source tower
height is retained. Missing panels are never synthesized. Exported panels must
be consecutive from Panel 1 because the consuming connector renumbers them.

The supplied OpenTower-convention sample declares 46 panels but contains only
Panels 1 and 2: 6 legs, 15 braces, and 18 shared nodes. It needs `--allow-partial`.

## Library API

After building, a script in this folder can use:

```javascript
const fs = require("fs");
const { convertIfcToOtxml } = require(".");

const result = convertIfcToOtxml(fs.readFileSync("tower.ifc", "utf8"), {
    allowPartial: true,
});
fs.writeFileSync("recovered.otxml", result.xml, { flag: "wx" });
for (const warning of result.warnings) console.warn(warning);
console.log(result.counts);
```

The same API is available as `require("ifc-to-otxml")` when installed as a local
package. The result contains `xml`, `warnings`, and counts of `panels`, `legs`,
`bracingMembers`, and `nodes`. TypeScript declarations are emitted in `dist`.

## Package layout

- [src/IfcToOtxml.ts](./src/IfcToOtxml.ts): public API and short conversion workflow.
- [src/ConvertIfc.ts](./src/ConvertIfc.ts): standalone CLI.
- [src/ifc](./src/ifc): STEP reader, component builders, and geometry recovery.
- [test](./test): synthetic IFC fixtures and engine-only regression tests.
- [schema/otxml.xsd](./schema/otxml.xsd): extended OTXML validation schema.
- [README_IFC.md](./README_IFC.md): detailed extraction logic and architecture.

The builders follow `Panel -> Leg` and `Panel -> Face -> Segment -> PhysicalMember`.
Nodes, sections, and materials are shared registries within one conversion.
Geometry mathematics is separate from component assembly.

## OTXML schema

The [OTXML XSD](./schema/otxml.xsd) is based on the supplied `otxmlXSD.xml`,
extended to accept the converter's existing output without changing it. The
extensions cover materials, profile polylines, panel properties, member
releases, project coordinates, and partial-export metadata. The original
`Panel` form in `PanelProperties` remains supported.

The supplied schema specified one root-element order, while current converter
output uses another. The extended schema accepts known root elements in any
order, so it is intentionally more permissive than the supplied schema.
Most attributes remain optional strings as in the original; XSD validation
alone does not check required tower data, numeric values, references, units,
engineering correctness, or connector compatibility. This is a working
compatibility schema, not a certified complete OTXML specification.

The converter does **not** automatically validate output against the XSD.
To run the optional schema regression tests, install Python and `lxml`, then:

```powershell
npm run test:schema
```

These tests validate generated complete and partial examples and reject
unknown elements and attributes. Normal conversion and `npm test` do not
require Python or `lxml`. The schema is a foundation for a future common-data
serializer; that architectural split has not yet been implemented.

Runtime dependencies are only `@itwin/core-geometry` (pure geometry math) and
`xml-js` (XML serialization). [LegacyProfileMath.ts](./src/ifc/geometry/LegacyProfileMath.ts)
contains the small compatibility calculation needed to reproduce the original
connector's profile frame, including its rounding and transform order. It has
no connector-code or backend-SDK imports.

## Data sources and limits

- Panel/member classification, hierarchy, connectivity, beta, and releases come
  from IFC properties and `IFCRELNESTS`, not guessed bracing patterns.
- MS TOWER hollow-circle and six-vertex L-shape contours come from mapped faceted
  BREP geometry. Hollow-circle recovery needs a vertical representative with
  outer and inner contours.
- OpenTower solid circular and legacy parametric L-shape dimensions are measured
  from each member's caps, including tilted legs and generic section labels.
  Different measured sizes get separate IDs. Parametric sections intentionally
  have no `PolyLine` entries, preserving the consuming renderer's geometry path.
  Generic solid circles cannot establish engineering wall thickness (rendering
  value 0); named wall metadata is retained where available.
- L-shape `Thickness` reproduces the legacy renderer parameter, not necessarily
  the shortest boundary edge. Unsupported geometry fails, rather than being
  replaced with invented dimensions.
- Endpoints remain Y-up metres; panel dimensions remain exported feet; recovered
  profile dimensions use legacy connector inches (`metres = inches / 39.3701`).
  Site coordinates, exported tower tilt, and concrete height are retained.
- Material names are retained; missing names use `Default Steel`. Engineering
  properties are assumed generic steel values: E=205000, G=78846.153846, Fy=275,
  Fu=430 N/mm2; Poisson ratio=0.3; density=7850 kg/m3; unit weight=76.9822 kN/m3;
  thermal expansion=0.000012 /C; damping=0.03. They are not analysis-certified.
- Supports, mounts, equipment, plan/hip bracing, other profile families, and
  arbitrary IFC exporters remain outside the supported scope. Invalid hierarchy,
  conflicting properties, unsupported units, and unrecoverable profiles fail
  explicitly.
- Exported values are rounded and original source IDs are lost. Five-character
  leg releases are preserved. This is not a byte-identical restoration of the
  original source OTXML or a certified structural model.

## Relationship to the connector

Only the generated OTXML crosses into the connector's normal input flow.
Connector compatibility tests stay in the connector project, not in this package.
The repository root retains optional `convert:ifc` and `test:ifc` shortcuts;
the latter runs the 9 engine tests plus 2 connector-reader compatibility tests.
The connector's runtime code and EC schema are unchanged.
