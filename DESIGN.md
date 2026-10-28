---
name: Ambit
description: What you, your agents, and your machines can jointly do, drawn as an instrument panel over a capability map.
colors:
  readout-blue: "#7aa2f7"
  readout-blue-pressed: "#6b93e8"
  readout-blue-soft: "rgba(122, 162, 247, 0.13)"
  readout-blue-line: "rgba(122, 162, 247, 0.45)"
  needs-violet: "#b89af0"
  held-ground: "#3a5288"
  held-ground-ring: "#7896dc"
  passing-green: "#56c28a"
  caution-amber: "#e0a94a"
  failing-red: "#ef6461"
  failing-red-deep: "#d8504d"
  heat-1: "#a3691f"
  heat-2: "#c98a2c"
  heat-3: "#e8b04b"
  heat-4: "#f5cd6e"
  kind-agent: "#e58bb4"
  kind-provider: "#4fb0d6"
  kind-model: "#8c9cf2"
  kind-combo: "#a58cf0"
  kind-tool: "#d28a4f"
  kind-device: "#4db6a8"
  kind-network: "#5aa7d6"
  ink-canvas: "#0f1013"
  ink-glass: "#131418"
  ink-surface: "#16171b"
  ink-elevated: "#1d1f24"
  ink-inset: "rgba(0, 0, 0, 0.3)"
  scrim: "rgba(0, 0, 0, 0.65)"
  hairline: "rgba(255, 255, 255, 0.08)"
  hairline-bright: "rgba(255, 255, 255, 0.13)"
  hairline-hover: "rgba(255, 255, 255, 0.2)"
  text-primary: "#e8e8ea"
  text-secondary: "#a4a7ae"
  text-muted: "#8a8e96"
typography:
  display:
    fontFamily: "Hubot Sans, Mona Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "36px"
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112.5"
  title:
    fontFamily: "Hubot Sans, Mona Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 750
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 112.5"
  figure:
    fontFamily: "Hubot Sans, Mona Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.01em"
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 112.5"
  headline:
    fontFamily: "Hubot Sans, Mona Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 700
  body:
    fontFamily: "Mona Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hubot Sans, Mona Sans, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.08em"
    fontVariation: "'wdth' 87.5"
  code:
    fontFamily: "Monaspace Neon, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  xs: "4px"
  sm: "6px"
  default: "8px"
  md: "10px"
  lg: "12px"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.readout-blue}"
    textColor: "{colors.ink-canvas}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.readout-blue-pressed}"
    textColor: "{colors.ink-canvas}"
  button-secondary:
    backgroundColor: "{colors.ink-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "32px"
  button-small:
    backgroundColor: "{colors.ink-surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "26px"
  button-ghost:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "26px"
  view-tab:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
  view-tab-active:
    backgroundColor: "{colors.ink-elevated}"
    textColor: "{colors.text-primary}"
  filter-chip:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.full}"
    padding: "3px 9px"
  status-pill:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  plate:
    backgroundColor: "{colors.ink-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "18px 20px 16px"
  finder-input:
    textColor: "{colors.text-primary}"
    padding: "0 16px"
    height: "46px"
  map-node-reached:
    backgroundColor: "{colors.held-ground}"
    size: "44px"
  map-node-failing:
    backgroundColor: "{colors.failing-red}"
    size: "44px"
---

# Design System: Ambit

## Overview

**Creative North Star: "The Instrument Panel"**

Ambit is read the way an instrument panel is read: a dark, quiet housing, and on it only the lights that mean something. The ground is ink with a trace of warmth, never navy, so a colour on the page is always a reading: blue for what the panel points at and the steps just past the frontier, green for a check that passed, red for one that failed, amber for caution and for the attention lens. Titles and figures are set wide in Hubot Sans the way a readout sets them, column and section labels narrow and in caps, and everything a person reads as text is Mona Sans. What a person types is Monaspace Neon.

The capability map is the panel's main instrument and the reason the rest exists. Its eras run as columns, what the setup reaches is drawn as filled ground, the frontier's next steps as blue rings around nothing, and every other state as a mark with one meaning. The other views (My Setup, Audit, Proposals, Time & cost) are the panel's gauges: flat plates of figures and rows, laid on the same ink, quiet until something on them needs a person.

Density is high and deliberate: an operator's surface, at 14px body on an eight-step scale, with nothing ornamental between the reader and the reading. The system is dark only (`color-scheme: dark`). The confirmed anti-reference is the palette it replaced: a framework's defaults, slate grounds, an indigo accent and two radial glows behind everything.

**Key Characteristics:**
- One accent, Readout Blue, and four status colours; every other hue names a kind of node.
- Three faces with one job each: Hubot reads out, Mona is the text, Monaspace is typed.
- Flat ink plates that catch the light along their top edge; shadow only on what floats.
- Every map state carried by shape, texture or a mark as well as colour.
- Quiet until pressed: thin hairlines, low-contrast grounds, colour reserved for data and the one primary action.

## Colors

A near-neutral ink with one soft blue, four status colours and a fixed hue per kind of node; colour appears only where it carries a fact.

### Primary
- **Readout Blue** (#7aa2f7): what the panel points at. The next-step ring on the map, the "enables" direction of an edge, what an unlock simulation would open, the selection's corner brackets, the focus ring, links and the one primary action per view. Reads on the canvas as text at 7.5:1 and carries ink text as a fill at 7.5:1. **Readout Blue Pressed** (#6b93e8) is its hover and pressed step.

### Secondary
- **Needs Violet** (#b89af0): the other direction an edge runs from the node in focus, what it needs. The detail panel keys its two lists with the same pair. It replaced a teal that sat one step from Passing Green on every node.
- **Held Ground** (#3a5288) with **Held Ground Ring** (#7896dc): the fill and ring of a reached capability, so what the setup can already do reads as ground held and the next steps read as its edge.

### Tertiary
- **Passing Green** (#56c28a): a check that passed, and nothing else on the map; a passing node carries a tick. An unlock preview used it too, which made one hue say three things.
- **Caution Amber** (#e0a94a): caution, waiting, and a capability that loses one provider but keeps another in an outage simulation.
- **Failing Red** (#ef6461), with **Failing Red Deep** (#d8504d): a check that failed, a node that is down in a simulation, a refusal. Never shown without its stripes or its `!`.
- **The Heat Ramp** (#a3691f, #c98a2c, #e8b04b, #f5cd6e): the attention lens, one hue in four steps, brighter with more. Monotonic in luminance and each step clears 3:1 on the canvas, so the order reads without the key.
- **Kind hues**: agent pink (#e58bb4), provider cyan (#4fb0d6), model periwinkle (#8c9cf2), combo violet (#a58cf0), tool copper (#d28a4f), device teal (#4db6a8), network sky (#5aa7d6). A server is Caution Amber, a skill Passing Green, a framework Readout Blue and anything else Muted Text. The map, the detail panel, My Setup and the docs read the same tokens, so a server is the same amber everywhere.

### Neutral
- **Ink Canvas** (#0f1013): the page and the map's ground; also the text colour on any blue, green or red fill.
- **Ink Glass** (#131418): the header bar and what floats over the map.
- **Ink Surface** (#16171b): plates, panels, the finder, popovers.
- **Ink Elevated** (#1d1f24): the active view tab, secondary buttons, a raised row.
- **Ink Inset** (rgba(0, 0, 0, 0.3)): the recessed ground a segmented control sits in.
- **Hairlines** (rgba(255, 255, 255, 0.08), brightening to 0.13 and 0.2 on hover): every border.
- **Text** (#e8e8ea primary, #a4a7ae secondary, #8a8e96 muted): off-white for long reads; muted text clears 5:1 on every ground it sits on.

### Named Rules
**The Lit Reading Rule.** Colour on the page is a reading. A hue that means nothing is not added, and no surface carries a tint for atmosphere.

**The One Blue Rule.** Readout Blue is the only accent. A second accent, a gradient or a glow is a regression to the palette this one replaced.

**The Ink-On-Fill Rule.** Text on a blue, green or red fill is Ink Canvas, never white. White on a saturated fill was 4.5:1 at best and glared at the size of a button.

## Typography

**Display Font:** Hubot Sans (with Mona Sans, then the system sans)
**Body Font:** Mona Sans (with the system sans)
**Label/Mono Font:** Hubot Sans at narrow width for labels; Monaspace Neon (with SF Mono, Menlo) for what a person types

**Character:** One family at three widths does the work of a panel: wide for what a thing is called and how much of it there is, narrow caps for the label over a column, and Mona at normal width for anything read as a sentence. Monaspace marks a command as something to paste.

### Hierarchy
- **Display** (Hubot 750, 36px, 1.15, wide): the welcome screen's title; 28px under 720px.
- **Title** (Hubot 750, 20px, wide): what a view, a dialog or a verdict is called, and the wordmark.
- **Figure** (Hubot 800, 28px, 1.1, wide, tabular): a KPI at a glance. A count inside a line uses Hubot 700 at the line's own size and width, with tabular figures, so the header pill does not grow.
- **Headline** (Hubot 700, 14px, normal width): what a plate, a section or a proposal is about.
- **Body** (Mona 400, 14px, 1.5): everything read as text. Weights 500, 600 and 700 mark emphasis.
- **Label** (Hubot 700, 12px, narrow, uppercase, 0.08em): era names, table heads, section labels, callouts on the map.
- **Code** (Monaspace Neon 400, 12px): commands, ids and paths.

### Named Rules
**The Eight Steps Rule.** Sizes are 11, 12, 13, 14, 16, 20, 28 and 36px, and nothing between. A half-pixel step reads as a mistake, not a level.

**The Roles Block Rule.** Which selectors take Hubot is listed once, under TYPE ROLES at the end of `App.css`, by role and not by size. A new title, figure or label joins its role there; it does not set the family itself.

## Layout

A fixed header bar (52px; 96px on a phone, where the view tabs drop to their own full-width row) over a full-bleed working area. The map fills the area edge to edge with its controls floating over it: the finding pill at the top, zoom and lens tools, the minimap and the timeline under it. Panels and cards lay over the map at the right or bottom, and the map reframes so no era column is cut at a panel's edge. The plate views (My Setup, Audit, Time & cost, Proposals) scroll as a single column of plates.

The map's grid is fixed: columns 170px wide, rows 105px tall, nodes 44px across, each era on a faint band (rgba(255, 255, 255, 0.018), 12px corners). A frame starts on a whole column, never a sliver of one.

The map never picks a zoom below 0.9 for itself on a wide screen, where a name (12 in the scene) draws at 10.8px. At rest it shows every column when they all fit at that size (all nine at 93% on 1440px). Otherwise it shows as many whole columns as do, starting at the first era holding a next step, so the frontier leads and the ground already held is a scroll away, on the minimap. A phone takes three whole columns from the same place. Beside the detail panel, the frame holds a whole number of columns that exactly fills the room to the panel's edge. A simulation may zoom out further to show everything it lights; a selection keeps the reading zoom.

Context outside a selection, focus, lens or simulation fades: its circle drops to 0.25 (0.45 for ground already held and working), and its name stays in muted grey at full strength, 5.6:1 on the band. A faded node is still a control, so its name is held to text contrast; the circle carries the fade.

Spacing has no token scale. Observed values cluster on even steps (4, 6, 8, 10, 12, 16 and 20px), 8px the most common gap; plates pad 18px by 20px and the header 14px at its sides. Breakpoints: 768px is the phone line; the header shows its view tabs as icons up to 1270px and as icon plus label above 1420px (1520px on the demo), so every control stays on screen from 769px.

### Named Rules
**The Whole Column Rule.** A frame of the map never cuts an era column at the left edge or under a panel. Beside a panel, the map shows the whole tree only when it reads there at 0.9 or more, and otherwise as many whole columns as fill the room to the panel's edge.

**The Readable Name Rule.** The map chooses no zoom of its own below 0.9 on a wide screen, and a faded name keeps 4.5:1 or better. A view that fits everything by drawing it too small to read has shown nothing.

## Elevation & Depth

Flat by default, with one exception per kind of surface. Plates lie on the canvas and are told from it by tone and a hairline, plus a single lit pixel along the top edge (`inset 0 1px 0 rgba(255, 255, 255, 0.04)`) so a plate reads as a surface laid down, not a box drawn. Real shadow belongs only to what floats over the map or the page.

### Shadow Vocabulary
- **Header** (`0 1px 2px rgba(0, 0, 0, 0.25)`): the header bar and the active view tab.
- **Floating** (`0 4px 14px rgba(0, 0, 0, 0.3)`): the finding pill over the map and popovers.
- **Lifted** (`0 10px 30px rgba(0, 0, 0, 0.4)`): cards laid over the map.
- **Modal** (`0 24px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.07)`): dialogs and the finder, over a 0.65 black scrim.

### Named Rules
**The Lit Edge Rule.** A plate on the canvas gets the one-pixel lit top edge and no drop shadow. A drop shadow says the thing floats; a plate does not.

## Shapes

Gently rounded rectangles for controls and plates, full pills for chips and status, and circles for capabilities. Controls take 6px corners, popovers 8px, plates, dialogs and the finding card 12px; segmented-control buttons 4px inside their inset. Lines are 1px hairlines everywhere outside the map.

On the map, form carries meaning. A capability is a circle; a required edge is solid and an optional one dashed; a next step is a ring with nothing inside; a blocked node is faded and dashed. Each mark below means one thing:

- **Corner brackets**: what the map points at, the selection or the node the finding names.
- **Hazard stripes**: something that refuses: a failing check, a forbidden grant, a spend past its ceiling.
- **The waver**: recovering. The ring slips off its fill, further the more of the last five checks failed. At rest only.
- **Corrosion**: what an outage simulation stops. The fill is eaten through inside an intact ring. Never at rest.
- **The keystone wedge**: a node many others rest on.
- **The part fill**: how much a next step was asked for.
- **The seal**: a signature something can verify. Signed approvals only.
- **Actor marks**: circle for a person, rounded square for an agent, hexagon for a machine, diamond for Ambit; drawn only when the id's prefix says which.

### Named Rules
**The One Meaning Rule.** A mark stands for one fact. A new use either fits that fact exactly or gets its own mark. Blurring a stale check was rejected under this rule, since the header would still count the node as proven.

## Components

Quiet until pressed: thin hairlines, ink grounds a step off the canvas, secondary text, and colour only on the one primary action and the data.

### Buttons
- **Shape:** gently rounded (6px).
- **Primary:** Readout Blue fill, Ink Canvas text at 600, 32px tall, 14px sides. One per view.
- **Hover / Focus:** primary steps to Readout Blue Pressed; secondary brightens its hairline to 0.13 and its text to primary. Transitions are 0.15s ease on colour, border and ground. Focus everywhere is a 2px Readout Blue outline at 2px offset.
- **Secondary:** Ink Elevated ground, hairline border, primary text, 32px. **Small:** Ink Surface, secondary text, 26px. **Ghost** (map tools): no ground or border until hover. **Inline:** text with a dotted underline, for an action inside a sentence.

### Chips
- **Style:** full pill, transparent ground, hairline border, muted text at 12px.
- **State:** hover brightens the border and the text a step. The header's status pill is the same shape on a faint ground, carrying verified, failing and next-step counts, and folds its last count into its tooltip before it would wrap.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Ink Surface on the canvas.
- **Shadow Strategy:** the lit top edge only (see Elevation & Depth).
- **Border:** 1px hairline.
- **Internal Padding:** 18px top, 20px sides, 16px bottom.

### Inputs / Fields
- **Style:** the finder's field is borderless on the dialog's ground with a hairline under it, 46px tall, 14px text.
- **Focus:** the field shows no ring of its own; the dialog holds the focus.

### Navigation
- **Style:** five view tabs in the header, Mona 500 at 13px, transparent with secondary text.
- **Hover:** a faint white ground and primary text. **Active:** Ink Elevated ground, bright hairline, header shadow, weight 600.
- **Narrow screens:** icons with an `aria-label` up to 1270px; on a phone the tabs take their own full-width row under the brand and actions. The waiting-proposal count rides on the Proposals tab.

### The Map Node
The signature component. A 44px circle on a 170 by 105 grid. Reached: Held Ground fill, Held Ground Ring. Next step: a Readout Blue ring around nothing, with its setup time. Blocked: faded and dashed. Passing: Passing Green with a tick. Failing: Failing Red with `!` and hazard stripes. Recovering: the waver. Selected: corner brackets. An edge from the node in focus is violet toward what it needs and blue toward what it enables. In an unlock simulation the step is filled Readout Blue and what it would open is drawn as held ground ringed in Readout Blue.

The map is one Tab stop: the selected node, else the last one the arrows reached, else the node the finding names. The arrows walk the grid (up and down an era, across to the nearest row of the next), Enter opens a node, and a focused node wears a Readout Blue ring 6px outside its circle in place of the page's outline.

### The Finding
The map's one sentence, in a pill at the top of the map: Ink Glass ground, a Readout Blue hairline at 0.45, the floating shadow, 12px corners. It names a failing check, else the best next step, and its target wears corner brackets in the same colour.

## Do's and Don'ts

### Do:
- **Do** use Readout Blue (#7aa2f7) only for what the panel points at: next steps, what an unlock would open, the selection, focus, links and the one primary action per view.
- **Do** keep Passing Green for a check that passed.
- **Do** carry every map state by shape, texture or mark as well as colour, so the map reads in greyscale.
- **Do** pick a size from the eight steps (11, 12, 13, 14, 16, 20, 28, 36px) and a role from the TYPE ROLES block.
- **Do** set counts with tabular figures, so a changing number does not move its neighbours.
- **Do** put Ink Canvas (#0f1013) text on any coloured fill.
- **Do** give a plate the lit top edge and keep drop shadows for what floats.
- **Do** stop non-essential motion under `prefers-reduced-motion`, with `transition-duration: 0s`, not 0.01ms, which lands every layout change a frame late.

### Don't:
- **Don't** add a second accent, a gradient, or radial glows behind the page; that was the framework-default palette this one replaced.
- **Don't** use a slate or navy ground; the ink keeps a trace of warmth so the only colour is colour that means something.
- **Don't** reuse a mark for a second meaning, draw corrosion at rest, or blur a node to say its check is stale.
- **Don't** put a hue next to Passing Green that a reader could take for it, as the old teal "needs" edge was.
- **Don't** set white text on a saturated fill.
- **Don't** cut an era column at the frame's edge or under a panel.
- **Don't** add a CSS framework or utility classes; the styles are vanilla CSS on custom properties.
