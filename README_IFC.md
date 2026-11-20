# Reading OpenTower IFC and Recovering OTXML

This guide explains how the converter identifies panels and members, extracts
their properties, and rebuilds the OTXML hierarchy. It also describes what to
inspect when mounts and equipment are added to future IFC exports.

The converter is a standalone package. For installation, build, test, CLI, and
library usage, start with [README.md](./README.md).

## 1. The main idea

An IFC file is not just a collection of 3D shapes. It can contain:

- Objects and their IFC types.
- Names and source-application class descriptions.
- Custom properties grouped into property sets.
- Relationships between objects.
- Geometry, placements, units, and site information.

For the supplied tower, we identify panels using **exported OpenTower metadata**,
not by guessing from their geometry.

The conversion follows this sequence:

```text
Read IFC statements
    -> Index entities by reference ID
    -> Attach property sets to objects
    -> Classify OpenTower components
    -> Reconstruct parent-child relationships
    -> Recover member section contours from geometry
    -> Map the recovered data into OTXML
```

The current implementation supports Bentley iModel OpenTower IFC2X3 exports
for `MS TOWER` and `OpenTower` convention / `SelfSupported` towers. These mappings are not universal rules
for every IFC file or exporter.

## 2. Understanding an IFC statement

The supplied IFC uses the STEP text format:

```text
#1352=IFCBUILDINGSTOREY(...);
```

| Part | Meaning |
| --- | --- |
| `#1352` | Entity reference ID within this IFC file |
| `IFCBUILDINGSTOREY` | IFC entity type |
| `(...)` | Positional attributes defined by the IFC schema |
| `#1380` inside an attribute | Reference to another entity |
| `'Panel 1'` | String value |
| `$` | Unset attribute |
| `IFCREAL(2.774)` | Typed numeric value |
| `IFCINTEGER(1)` | Typed integer value |
| `IFCTEXT('Panel')` | Typed text value |
| `.T.` / `.F.` | Logical true / false |
| `;` | End of a statement |

A statement can span multiple lines. A parser must also account for quoted
strings, escaped apostrophes, nested parentheses, and comments.

**Do not confuse these three identifiers:**

- `#1352`: a reference within this export, not a physical line number.
- `PanelID = 1`: an OpenTower panel number stored as a property.
- The object's IFC `GlobalId`: a separate identifier in its declaration.

Reference IDs can change in another export. Never hardcode the sample IDs in
extraction logic.

### Why build an entity lookup first?

References may point to statements appearing later in the file. The converter
first indexes retained entities:

```text
Entity reference -> IFC type + attribute list
```

It can then resolve relationships independently of statement order.

See `splitStep`, `stepText`, and `references` in
[StepParser.ts](./src/ifc/StepParser.ts). The public conversion entry point remains
`convertIfcToOtxml` in [IfcToOtxml.ts](./src/IfcToOtxml.ts).

## 3. How we identify a panel

The following is an actual declaration from the supplied IFC:

```text
#1352=IFCBUILDINGSTOREY('2HTvyVuag2GBagPsGlM3AX',#6,'Panel 1','[OpenTower].[Panel]','<null>',#1380,$,$,.ELEMENT.,$);
```

It contains two useful clues:

```text
Display name:              Panel 1
OpenTower class description: [OpenTower].[Panel]
```

Its attached properties provide the explicit classification:

```text
#1376=IFCPROPERTYSINGLEVALUE('ComponentName',$,IFCTEXT('Panel'),$);
```

This means:

```text
ComponentName = Panel
```

The converter classifies panels using this attached `ComponentName` property.
The source-class description is supporting evidence; the display name alone
is not a reliable classifier.

### Why IFC type alone is insufficient

In this export, OpenTower concepts are mapped onto these IFC types:

| IFC entity type | OpenTower meaning in this file |
| --- | --- |
| `IFCBUILDING` | Tower model |
| `IFCBUILDINGSTOREY` | Panel |
| `IFCBEAM` | Leg or tower member |
| `IFCSPACE` | Face-bracing group |
| `IFCWALL` | Face |
| `IFCWINDOW` | Segment |

An `IFCWINDOW` here represents a bracing segment, not a building window.
Similarly, both a leg and a diagonal can be `IFCBEAM` objects.

Use the exported metadata to distinguish these components.

## 4. How properties connect to an object

A property does not directly identify its owning object. The connection is:

```text
Object
    <- IFCRELDEFINESBYPROPERTIES ->
Property set
    -> Individual properties
```

For Panel 1, the actual reference chain is:

```text
Panel object #1352
    |
    | IFCRELDEFINESBYPROPERTIES #1378
    v
Property set #1377: [OpenTower].[Panel]
    |
    +-- #1360: PanelID = 1
    +-- #1370: Height of Panel = 2.774
    +-- #1374: Face Bracing of Panel = X BRACE
    +-- #1376: ComponentName = Panel
```

The relationship is:

```text
#1378=IFCRELDEFINESBYPROPERTIES('1s1KCz9pz4u8XNN2IHr81S',#6,$,$,(#1352),#1377);
```

Its last two attributes mean:

```text
Related objects:       (#1352)
Property definition:  #1377
```

The extractor:

1. Finds an `IFCRELDEFINESBYPROPERTIES` relationship.
2. Resolves the referenced `IFCPROPERTYSET`.
3. Resolves each `IFCPROPERTYSINGLEVALUE` in that set.
4. Decodes the property names and typed values.
5. Associates them with each related object.

This produces an object-specific dictionary, conceptually:

```json
{
  "PanelID": "1",
  "ComponentName": "Panel",
  "Height of Panel": "2.774",
  "Top Elevation of Panel": "284.762",
  "Bottom Elevation of Panel": "281.988",
  "Face Bracing of Panel": "X BRACE",
  "Number Of Segments in Panel": "1"
}
```

The converter currently reads the OpenTower property sets and `Site_Data`.
It does not interpret every possible IFC property or quantity-set format.

**Do not infer ownership from neighboring lines. Follow the relationship.**

## 5. How we reconstruct the hierarchy

Properties tell us what an object is. `IFCRELNESTS` tells us its parent in this
OpenTower export.

For example:

```text
#1381=IFCRELNESTS('3_b0BMVhf9KhPYI7EvJ$kZ',#6,$,$,#263,(#1352));
```

This connects:

```text
Parent #263:  BaseStructure
Child #1352:  Panel 1
```

Another relationship connects Panel 1 to Leg_A:

```text
#2746=IFCRELNESTS('2PXLcJZKvFOQB$KJGO$$d_',#6,$,$,#1352,(#1382));
```

Following these references reconstructs:

```text
TowerModel
+-- BaseStructure
    +-- Panel 1
        +-- Leg_A
        +-- Leg_C
        +-- Leg_B
        +-- FaceBracing
            +-- FaceA
            |   +-- Segment 1
            |       +-- DIAGONAL 1
            |       +-- DIAGONAL 2
            |       +-- TOPHORIZONTAL 1
            +-- FaceB
            +-- FaceC
```

The converter maintains a child-to-parent lookup. It can walk upward from a
member to determine its panel and can find direct children when writing OTXML.

This avoids relying on names such as `ParentName`, which can be repeated or
less precise than the explicit relationships.

## 6. Mapping panel properties into OTXML

After extracting the dictionary, the converter applies an explicit mapping:

| IFC property name | OTXML attribute |
| --- | --- |
| `PanelID` | `PanelID` |
| `Height of Panel` | `Height` |
| `Top Width of Panel` | `TopWidth` |
| `Bottom  Width of Panel` | `BottomWidth` |
| `Top Elevation of Panel` | `TopElevation` |
| `Bottom Elevation of Panel` | `BottomElevation` |
| `Face Bracing of Panel` | `FaceBracing` |
| `Plan Bracing of Panel` | `PlanBracing` |
| `Hip Bracing of Panel` | `HipBracing` |
| `Number Of Segments in Panel` | `NumberOfSegments` |
| `Weight of Panel` | `Weight` |

The exported bottom-width property contains **two spaces** between `Bottom`
and `Width`. Property-name matching must account for the actual exported keys.

For example, the extracted values become:

```xml
<PanelProperty
  PanelID="1"
  Label="Panel 1"
  Height="2.774"
  TopElevation="284.762"
  BottomElevation="281.988"
  FaceBracing="X BRACE"
  NumberOfSegments="1" />
```

This example shows selected attributes only.

Panel height and bracing labels are already present in IFC. We do not calculate
them from a mesh or regenerate members from the `X BRACE` label.

## 7. Metadata extraction versus geometry recovery

These are separate operations:

| Required data | Source used by the converter |
| --- | --- |
| Component classification | Attached `ComponentName` property |
| Panel dimensions and bracing labels | Panel property set |
| Panel/member ownership | `IFCRELNESTS` |
| Member endpoints, beta angles, releases | Member property set |
| Section reference | Member's `Section` or `Section Name` |
| Section contour | Representative member's IFC geometry |
| Missing material engineering values | Reported generic steel defaults |

For section recovery, the converter resolves representation maps and local
placements, extracts cap boundaries from faceted BREP geometry, and inverts the
existing connector's profile orientation for MS TOWER contour-based members.
This prevents applying beta rotation twice.

It supports the MS TOWER sample's hollow-circle and six-vertex L-shape profiles. Hollow
circles require a vertical representative with outer and inner contours.
Unsupported profile geometry fails explicitly rather than becoming a guessed
shape.

### OpenTower-convention parametric members

The second supplied IFC uses the same component/property/nesting hierarchy, but
its member geometry was generated through a different existing connector path:

- Legs have named references such as `HollowCircle_1.1875`, but are slightly
  tilted. A vertical representative does not exist.
- Braces contain generic labels such as `HollowCircleProfile` and
  `LShapeProfile`. These are **shape families**, not unique section sizes.
- The file also contains many unused profile definitions, including an invalid
  `LShape_-1_-1`. Selecting the first definition with a matching shape would be
  incorrect.

For these members the converter:

1. Resolves each member's mapped BREP geometry and placements.
2. Finds a cap plane using face normals aligned with its endpoint direction.
3. Extracts its boundary, removing internal cap triangulation edges.
4. Verifies that both ends describe a straight, constant-section member.
5. Measures circular radius or recovers the legacy L-shape parameters.
6. Separates different dimensions behind the same generic label into distinct
   section IDs. Generated names include the representative IFC beam ID; original
   generic labels alone are not treated as unique section identities.
7. Writes parametric sections **without `PolyLine` entries**, so the unchanged
   reader and geometry builder use the same path as the original model.

The exported circular meshes are solid. Named profile wall-thickness metadata
is retained where present, but a generic solid mesh cannot recover an engineering
wall thickness; its rendering value is 0. The current parametric circular
renderer itself produces a solid cylinder regardless of wall-thickness metadata.

The legacy parametric L renderer places its re-entrant corner at
`(-Thickness, Thickness)`, rather than treating `Thickness` as the shortest
boundary edge. For its supported six-vertex shape, `Depth` is the longest edge
and `Thickness = Depth / 2 - shortest edge`. Recovering that parameter reproduces
the current renderer; it does not certify or correct its section definition.

The supplied file recovers a 1.1875-inch circular radius and L parameters
`Depth=2`, `Thickness=0.1875` inches. Rounded profile properties are not used in
place of the actual mesh measurements. Missing `TowerShape` is left absent;
exported tower tilt and concrete height are retained as metadata.

## 8. Units and coordinate conventions

Do not assume the IFC project's length unit applies to every custom property.

In the supplied export:

- IFC project geometry uses metres.
- Member endpoint properties are OTXML Y-up coordinates in metres.
- Panel elevations and widths are exported in feet.
- Recovered section dimensions are written in connector inches.

The existing OTXML reader transforms endpoint coordinates:

```text
OTXML (x, y, z) -> connector spatial (x, -z, y)
```

Therefore:

- Write endpoint properties into OTXML without another rotation.
- Resolve placements when interpreting IFC mesh coordinates.
- Do not apply those mesh placements again to the exported endpoint properties.

The consuming connector applies this node mapping. The independent converter's
compatible profile orientation and inch conversion are implemented in
[LegacyProfileMath.ts](./src/ifc/geometry/LegacyProfileMath.ts); it does not import
the connector's utilities.

## 9. Extending this to mounts and equipment

The current converter does not yet convert mounts or equipment. Adding them
requires inspecting an IFC containing those objects and implementing their
own extraction, validation, and OTXML mappings.

For each new component, inspect:

1. **Object declaration:** its IFC type, name, and source-class description.
2. **Classification properties:** whether `ComponentName` or another stable
   source identifier names the component.
3. **Property sets:** which dimensions, equipment types, orientations, offsets,
   or elevations were actually exported.
4. **Relationships:** which tower, platform, mount, or other object owns or
   supports it.
5. **Geometry and placements:** its actual shape and coordinate frame.
6. **OTXML requirements:** what the existing connector reader expects for that
   component.

Do not assume a future mount or antenna uses a particular IFC type or repeats
the panel hierarchy.

Other exports may express relationships through:

- `IFCRELNESTS`: nested objects.
- `IFCRELAGGREGATES`: decomposition into parts.
- `IFCRELCONTAINEDINSPATIALSTRUCTURE`: spatial containment.
- Other relationships describing connections or assignments.

Spatial containment and physical attachment are not automatically the same
thing. Inspect the relationship semantics before choosing an OTXML parent.

If metadata is removed by another exporter, object classification may require
an exporter-specific mapping or geometry-based inference. A display name alone
should not be treated as proof.

### Recommended information to preserve during export

- Stable component type or source-class identifier.
- Original source-application element ID.
- Explicit parent and attachment relationships.
- Required properties with documented units.
- Geometry and placement information.

Preserving these fields is more reliable than trying to rediscover their
meaning from meshes later.

## 10. A practical inspection workflow

When opening a new IFC in a text editor:

1. Check `FILE_SCHEMA` and `IFCAPPLICATION` to identify the schema and exporter.
2. Search for `ComponentName` and OpenTower class descriptions.
3. Pick one candidate object's reference ID.
4. Find relationships attaching property sets to that object.
5. Follow the property references and record the available fields.
6. Find nesting, aggregation, containment, or attachment relationships involving
   that object.
7. Trace its geometry and placements if geometry recovery is needed.
8. Compare the recovered fields with the required OTXML structure.
9. Validate counts, references, units, coordinates, and missing-data behavior.

Searches help locate statements, but a converter must parse and resolve
references rather than depend on line order.

## 11. Running and testing the converter

The IFC is the only conversion input:

```powershell
npm run convert -- "C:\data\tower.ifc" "C:\data\recovered.otxml"
# Explicitly allow a known incomplete export:
npm run convert -- "C:\data\partial.ifc" "C:\data\partial.otxml" --allow-partial
npm test
```

The output filename must not already exist. Feed the generated OTXML into the
normal connector flow to generate an iModel.

For the original MS TOWER sample, validation recovered:

- 45 panels.
- 135 legs.
- 273 bracing members.
- 138 shared nodes.
- Both section contours from IFC meshes.

All 408 members were matched against the original OTXML for validation, with a
maximum raw endpoint difference of approximately 0.061 mm. The original OTXML
was **not** a conversion input. A new cloud iModel has not been generated and
visually compared.

The supplied OpenTower-convention IFC declares **46 panels**, but contains only
**Panels 1 and 2: 6 legs, 15 bracing members, and 18 shared nodes**. Use
`--allow-partial` for that file. Without the flag, conversion fails explicitly.
With it, output contains only those two panels and reports the missing 44; it
does not recreate a complete 46-panel tower. `NoofPanel` records 2,
`SourcePanelCount` records 46, and `PartialExport` is `True`. Tower height still
describes the source tower. Partial exports must start at Panel 1 and remain
consecutive because the existing connector reader renumbers panels by order.
The API equivalent is `convertIfcToOtxml(ifc, { allowPartial: true })`.

All 21 exported members were checked against this IFC for panel/face/segment
ownership, endpoints, beta angles, releases, and measured section dimensions.
Raw exported endpoint values were preserved exactly. The unchanged OTXML reader
accepted the output, and its geometry builders produced 18 circular solids and
3 L-shape sweeps using a local projected-coordinate context. This is not a cloud
iModel generation or visual round-trip comparison.

Material properties use generic steel defaults and missing assignments use
`Default Steel`; these are not analysis-certified engineering data. Supports,
mounts, equipment, and plan/hip bracing remain outside the current scope.

## 12. Converter design and reading order

The converter uses **component builders composed together**, with a separate
IFC reader and geometry layer. There is no inheritance hierarchy, plugin
framework, or generic schema-to-XML generator to learn first.

Start with [IfcToOtxml.ts](./src/IfcToOtxml.ts). It coordinates the conversion;
it does not contain panel construction or mesh mathematics.
For the new source-to-common-data path, start with
[IfcToCommonData.ts](./src/IfcToCommonData.ts). It reads the IFC model and
builds the versioned [CommonData.ts](./src/CommonData.ts) directly, reusing
the member, node, section, and material registries. It does not serialize or
parse OTXML. The separate OTXML generator consumes that data.

### Component ownership in code

The main call structure follows the generated OTXML:

```text
convertIfcToOtxml
    |
    +-- IfcModel -> StepParser
    +-- readTower: validate convention, units, panel counts and ownership
    |
    +-- buildPanel
    |       +-- PanelProperty
    |       +-- buildLeg
    |       |       +-- PhysicalMemberBuilder.build
    |       +-- FaceBracingDetails
    |               +-- buildFace
    |                       +-- buildSegment
    |                               +-- PhysicalMemberBuilder.build
    |
    +-- PhysicalMemberBuilder.finish: verify every IFC beam was consumed
    +-- ProjectData and TowerInformation
    +-- writeOtxml
```

For example, to understand one panel:

1. Open [Panel.ts](./src/ifc/otxml/Panel.ts). Its property map shows which IFC
   fields become panel attributes. `buildPanel` validates the panel's child
   groups and calls its leg and face builders.
2. Open [Leg.ts](./src/ifc/otxml/Leg.ts) for the leg wrapper, or
   [Face.ts](./src/ifc/otxml/Face.ts) for the face's segments.
3. [Segment.ts](./src/ifc/otxml/Segment.ts) gets its own tower members from
   `IfcModel.children`, not from a guessed name or bracing pattern.
4. Both legs and segment members call the same
   [PhysicalMemberBuilder](./src/ifc/otxml/PhysicalMember.ts). It writes endpoint
   references, sections, materials, releases, beta, labels, and source IDs.
5. Only follow [Sections.ts](./src/ifc/otxml/Sections.ts) into
   [ProfileRecovery.ts](./src/ifc/geometry/ProfileRecovery.ts) when you need to
   understand section geometry. Panel construction itself needs no mesh math.

`PanelProperty` remains in the root `PanelProperties` table, while `Panel`
contains its child elements. The panel builder returns both because this is
the structure the existing OTXML reader expects.

### Shared nodes, sections, and materials

One `PhysicalMemberBuilder` is created **per conversion**, and shared by every
panel. It owns the node, section, and material registries. A registry returns an
existing ID when an item has already been emitted.

Do not create a new member builder for each panel or leg: that would restart
IDs and break shared references. Separate calls to `convertIfcToOtxml` do create
fresh registries, so state does not leak between input files.

### How the EC schema helps

The original connector's `Connector.ecschema.xml` defines **iModel EC classes
and relationships**, not an OTXML XSD. It is not a package dependency or input.
Its `Panel`,
`Leg`, `FaceBracing`, `Face`, `Segment`, and `TowerMember` classes help explain
the component boundaries. Relationships such as `PanelOwnsLegs`,
`PanelOwnsFaceBracing`, and `FaceOwnsSegments` support that ownership model.

It does not replace the actual IFC property sets/nesting or the existing OTXML
reader's tag layout. Where a schema declaration and the observed export differ,
this refactor preserves the existing extraction and reader behavior. The EC
schema and existing iModel creation code are not modified.

### File responsibilities

| File | Purpose |
| --- | --- |
| [IfcToOtxml.ts](./src/IfcToOtxml.ts) | Public API and short conversion workflow |
| [IfcToCommonData.ts](./src/IfcToCommonData.ts) | IFC-to-common-data extraction and hierarchy |
| [CommonData.ts](./src/CommonData.ts) | Versioned common-data contract |
| [ConvertIfcToCommonData.ts](./src/ConvertIfcToCommonData.ts) | JSON output CLI and partial-export handling |
| [ConvertIfc.ts](./src/ConvertIfc.ts) | CLI input/output and conversion warnings |
| [StepParser.ts](./src/ifc/StepParser.ts) | STEP tokenization, text decoding, reference parsing, and entity indexing |
| [IfcModel.ts](./src/ifc/IfcModel.ts) | Attached properties, component lookup, direct children, and ancestry |
| [IfcTypes.ts](./src/ifc/IfcTypes.ts) | Shared entity and property types |
| [Tower.ts](./src/ifc/otxml/Tower.ts) | Tower-level validation, warnings, TowerInformation, and site ProjectData |
| [Panel.ts](./src/ifc/otxml/Panel.ts) | Panel properties, child validation, and panel assembly |
| [Leg.ts](./src/ifc/otxml/Leg.ts) | Leg wrapper and its physical member |
| [Face.ts](./src/ifc/otxml/Face.ts) | Face wrapper and its segments |
| [Segment.ts](./src/ifc/otxml/Segment.ts) | Segment wrapper and its physical members |
| [PhysicalMember.ts](./src/ifc/otxml/PhysicalMember.ts) | Shared member construction, references, defaults, and consumption checks |
| [Nodes.ts](./src/ifc/otxml/Nodes.ts) | Shared endpoint IDs and node elements |
| [Materials.ts](./src/ifc/otxml/Materials.ts) | Shared material IDs and documented steel defaults |
| [Sections.ts](./src/ifc/otxml/Sections.ts) | Section identity, representative selection, dimensions, and contour elements |
| [MemberGeometry.ts](./src/ifc/geometry/MemberGeometry.ts) | IFC placements, representation maps, and transformed BREP faces |
| [ProfileRecovery.ts](./src/ifc/geometry/ProfileRecovery.ts) | Profile frames, cap boundaries, and measured section dimensions |
| [Xml.ts](./src/ifc/otxml/Xml.ts) | XML element construction and escaped serialization |
| [LegacyProfileMath.ts](./src/ifc/geometry/LegacyProfileMath.ts) | Self-contained legacy profile frame and inch conversion |
| [IfcToOtxml.test.ts](./test/IfcToOtxml.test.ts) | Engine-only conversion and geometry-recovery tests |
| [TowerIfc.ts](./test/fixtures/TowerIfc.ts) | Synthetic IFC fixture builder shared by the tests |

### What this refactor preserves

The public API, CLI options, supported components, defaults, validation rules,
and existing iModel processing path are unchanged for direct OTXML conversion.
The [Common X extractor](./README.md#ifc-to-common-data-x) has a separate,
versioned output contract for IFC member groups and properties.
Both supplied IFC files were compared against
captured pre-refactor results: their **XML bytes, warning messages/order, and
counts are identical**.

Future mount/equipment support should add its own component builders after
inspecting actual exported data. This organization provides a place for those
builders; it does not enable them automatically.

For the supported scope, defaults, and command usage, also see the main
[README](./README.md).
