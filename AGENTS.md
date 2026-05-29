# Agent Guide: Toolchain Visualizer

This repository contains **Toolchain Visualizer**, a web-based React application for managing and visualizing the opencode toolchain with hexagonal mapping and AI consultants.

## Tech Stack & Architecture

- **Frontend Framework**: React, TypeScript, Vite, Vanilla CSS.
- **State Store**: Zustand (client-side state management) persisted to browser `localStorage` under the key `toolchain-visualizer-data`.
- **Backend / Mock API**: Express server (`server.ts`) for local orchestration/mock APIs.

## Core Codebase Structure

- `src/client/`
  - [App.tsx](file:///Users/kanav/dev/toolchain-visualizer/src/client/App.tsx): Main entrypoint and UI layout.
  - `components/`: Panels for visualizer management (e.g. [ConsultantPanel.tsx](file:///Users/kanav/dev/toolchain-visualizer/src/client/components/ConsultantPanel.tsx), [InfrastructurePanel.tsx](file:///Users/kanav/dev/toolchain-visualizer/src/client/components/InfrastructurePanel.tsx), [RepoScanPanel.tsx](file:///Users/kanav/dev/toolchain-visualizer/src/client/components/RepoScanPanel.tsx)).
  - `store/`: Zustand state definitions (e.g. [toolchainStore.ts](file:///Users/kanav/dev/toolchain-visualizer/src/client/store/toolchainStore.ts)).
- [server.ts](file:///Users/kanav/dev/toolchain-visualizer/server.ts): Local dev server orchestrating mock consultants.

## Core Rules & Conventions

1. **CSS & Styling**:
   - Utilize Vanilla CSS for all components. Keep layout calculations (especially hexagonal coordinates) aligned with the custom grid utility inside `App.css`.
2. **Git Hygiene**:
   - Never add `node_modules/` to Git. This folder is ignored in `.gitignore`.
   - Never add `.playwright-mcp/` directories or cache files; they are gitignored.
3. **Storage & Data schema**:
   - The JSON data schema for elements and connections is strictly outlined in the `README.md`. Any state transitions must preserve back-compatibility for this schema.
