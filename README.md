# Toolchain Visualizer

A web-based visualizer for managing and visualizing your opencode toolchain with hexagonal mapping and AI consultants.

## Features

- **Hexagonal Mapping**: Visualize your toolchain components as interconnected hexagons
- **Drag & Drop**: Rearrange components by dragging them to new positions
- **Connection Management**: Create and remove connections between components
- **AI Consultants**: Get specialized advice from different AI consultants (Architecture, Efficiency, Security, Cost)
- **Persistent Storage**: Your toolchain configuration is saved in localStorage
- **CRUD Operations**: Create, read, update, and delete toolchain items
- **Responsive Design**: Works on desktop and mobile devices

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or bun (bun is recommended for this project)

### Installation

```bash
# Using bun (recommended)
bun install

# Using npm
npm install
```

### Development

```bash
# Using bun
bun run dev

# Using npm
npm run dev
```

The application will be available at http://localhost:3000

### Building for Production

```bash
# Using bun
bun run build

# Using npm
npm run build
```

## How It Works

### Toolchain Items

Each item in your toolchain represents a component such as:
- Frameworks (OpenCode Core)
- MCP Servers (1Password, Playwright, Tailscale, etc.)
- Skills
- Agents
- Tools
- Possibilities (future architecture patterns that should stay visible without being treated as built components)

Each item has:
- **Name**: Display name of the component
- **Type**: Category of the component
- **Description**: Detailed explanation of what it does
- **Status**: Specified, Built, or Deprecated
- **Position**: X, Y coordinates on the hexagonal grid
- **Metadata**: Additional information specific to the item type

### Connections

Connections represent relationships between toolchain items, such as:
- Credential Access
- System Control
- Browser Automation
- Network Extension
- Repo Management
- Knowledge Access
- Memory Storage

### AI Consultants

Click on any toolchain item and then select an AI consultant to get specialized advice:

- **Architecture Consultant**: Focuses on scalability, maintainability, and integration points
- **Efficiency Consultant**: Identifies bottlenecks, redundancies, and optimization opportunities
- **Security Consultant**: Reviews potential vulnerabilities and suggests improvements
- **Cost Consultant**: Analyzes resource usage, licensing, and operational expenses

## Customization

You can customize the visualizer by modifying:

- **HexMap.jsx**: Change the hexagonal layout, colors, and interactions
- **ToolchainPanel.jsx**: Modify how items are displayed and edited
- **ConsultantPanel.jsx**: Change how consultant results are displayed
- **App.css**: Adjust the overall styling
- **HexMap.css**: Customize the hexagonal map appearance
- **ToolchainPanel.css**: Customize the toolchain panel styling
- **ConsultantPanel.css**: Customize the consultant panel styling

## Data Structure

The toolchain data is stored in localStorage under the key `toolchain-visualizer-data` and has the following structure:

```json
{
  "toolchainItems": [
    {
      "id": "unique-id",
      "name": "Item Name",
      "type": "framework|mcp-server|agent|provider|model|command|skill|config|possibility",
      "description": "Item description",
      "status": "specified|built|deprecated",
      "position": { "x": 0, "y": 0 },
      "meta": {}
    }
  ],
  "connections": [
    {
      "from": "item-id-1",
      "to": "item-id-2",
      "type": "connection-type"
    }
  ]
}
```

## Seeded Possibilities

The importer also seeds a Pi/ESP32 household companion possibility cluster so it remains visible during toolchain planning. The cluster captures:

- RPi 4B as the memory, policy, inference, status, and action gateway
- ESP32-S3 as the no-extra-hardware display, nanopixel, button, cache, and fallback surface
- self-healing manifests, cached mode, rollback, and adaptive polling
- household, TV, away, quiet, and guest-safe display contexts
- non-deterministic enrichment where models propose summaries, rule patches, and micro-cards while deterministic validators bound actions and privacy
- opportunistic free/free-starting cloud inference behind strict budgets, caching, timeouts, and local fallback

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
