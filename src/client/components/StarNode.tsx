import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Item } from '../utils/configImporter';

interface Props {
  item: Item;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

const TYPE_COLORS: Record<string, string> = {
  framework: '#00d4ff',
  'mcp-server': '#ff8c00',
  agent: '#00ff88',
  provider: '#ffd600',
  model: '#4488ff',
  command: '#8899aa',
  skill: '#ff44ff',
  config: '#ccaa88',
  possibility: '#ff5fb7',
  device: '#00ffaa',
  service: '#7c9cff',
  api: '#ffcc66',
  network: '#66e0ff',
  workflow: '#d16bff',
};

const TYPE_RADIUS: Record<string, number> = {
  framework: 0.6,
  'mcp-server': 0.35,
  agent: 0.3,
  provider: 0.4,
  model: 0.25,
  command: 0.3,
  skill: 0.35,
  config: 0.2,
  possibility: 0.28,
  device: 0.5,
  service: 0.32,
  api: 0.36,
  network: 0.38,
  workflow: 0.42,
};

function TargetBracket({ pos, color, pulse }: { pos: [number, number, number]; color: string; pulse: number }) {
  const r = 0.8;
  const len = 0.35;
  const t = pulse;
  const corners = [
    // Top-left
    [[-r, r - t * 0.1, 0], [-r + len, r - t * 0.1, 0]],
    [[-r, r - t * 0.1, 0], [-r, r - len - t * 0.1, 0]],
    // Top-right
    [[r, r - t * 0.1, 0], [r - len, r - t * 0.1, 0]],
    [[r, r - t * 0.1, 0], [r, r - len - t * 0.1, 0]],
    // Bottom-left
    [[-r, -r + t * 0.1, 0], [-r + len, -r + t * 0.1, 0]],
    [[-r, -r + t * 0.1, 0], [-r, -r + len + t * 0.1, 0]],
    // Bottom-right
    [[r, -r + t * 0.1, 0], [r - len, -r + t * 0.1, 0]],
    [[r, -r + t * 0.1, 0], [r, -r + len + t * 0.1, 0]],
  ];

  // Rebuilt only when the pulse changes, and disposed on unmount — building
  // these inline every render allocated eight GPU buffers per frame that were
  // never freed.
  const cornerGeometries = useMemo(
    () =>
      corners.map(([start, end]) =>
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(start[0], start[1], start[2]),
          new THREE.Vector3(end[0], end[1], end[2]),
        ])
      ),
    [pulse]
  );

  useEffect(() => () => cornerGeometries.forEach(g => g.dispose()), [cornerGeometries]);

  return (
    <group position={pos}>
      {cornerGeometries.map((geo, i) => (
        // lineSegments, not line: the `line` intrinsic collides with the SVG
        // element of the same name in React's JSX typings.
        <lineSegments key={i} geometry={geo}>
          <lineBasicMaterial color={color} transparent opacity={0.6 + 0.3 * Math.sin(Date.now() * 0.003 + i)} />
        </lineSegments>
      ))}
    </group>
  );
}

export function StarNode({ item, isSelected, isHovered, onSelect, onHover }: Props) {
  const ringRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Sprite>(null);
  const pulseRef = useRef(0);

  let color = TYPE_COLORS[item.type] || '#8899aa';
  if (item.status === 'deprecated') {
    color = '#ff3344';
  }

  const baseRadius = TYPE_RADIUS[item.type] || 0.3;
  const pos: [number, number, number] = [item.position.x, item.position.y, item.position.z];

  // Create a glow sprite texture
  const glowTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, color + '88');
    gradient.addColorStop(0.3, color + '44');
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }, [color]);

  useFrame(() => {
    if (ringRef.current) {
      ringRef.current.rotation.x += 0.005;
      ringRef.current.rotation.z += 0.008;
    }
    pulseRef.current = Math.sin(Date.now() * 0.002) * 0.5 + 0.5;
    if (glowRef.current) {
      glowRef.current.material.opacity = isSelected ? 0.4 + pulseRef.current * 0.2 : 0.15;
    }
  });

  return (
    <group position={pos}>
      {/* Glow sprite */}
      {item.status !== 'specified' && (
        <sprite ref={glowRef} scale={[baseRadius * 6, baseRadius * 6, 1]}>
          <spriteMaterial map={glowTexture} transparent opacity={0.15} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      )}

      {/* Connection point (small core / blueprint wireframe) */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect(isSelected ? null : item.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(item.id);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          onHover(null);
        }}
      >
        <sphereGeometry
          args={[
            item.status === 'specified' ? baseRadius * 1.1 : baseRadius * 0.3,
            item.status === 'specified' ? 12 : 8,
            item.status === 'specified' ? 12 : 8
          ]}
        />
        <meshBasicMaterial
          color={color}
          wireframe={item.status === 'specified'}
          transparent={item.status === 'specified'}
          opacity={item.status === 'specified' ? 0.15 : 1}
          depthWrite={item.status !== 'specified'}
        />
      </mesh>

      {/* Holographic ring */}
      {item.status !== 'specified' && (
        <mesh ref={ringRef}>
          <torusGeometry args={[baseRadius * 1.2, 0.015, 8, 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={isSelected ? 0.9 : isHovered ? 0.6 : 0.35}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Second counter-rotating ring */}
      {item.status !== 'specified' && (
        <mesh rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[baseRadius * 1.2, 0.01, 8, 32]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={isSelected ? 0.5 : 0.2}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Targeting bracket when selected/hovered */}
      {(isSelected || isHovered) && (
        <TargetBracket pos={[0, 0, 0]} color={color} pulse={pulseRef.current} />
      )}

      {/* Name label */}
      <Html
        position={[0, -baseRadius - 0.4, 0]}
        center
        distanceFactor={8}
        className="star-label-html-container"
      >
        <div
          className={`star-label-html ${isSelected ? 'selected' : ''} ${isHovered ? 'hovered' : ''} status-${item.status}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(isSelected ? null : item.id);
          }}
          onPointerOver={() => onHover(item.id)}
          onPointerOut={() => onHover(null)}
        >
          <div className="star-name">{item.name}</div>
          {isSelected && (
            <div className="star-type" style={{ color }}>
              {item.type.toUpperCase()}
            </div>
          )}
        </div>
      </Html>

      {/* Status indicator */}
      {item.status !== 'built' && (
        <mesh position={[baseRadius * 0.8, baseRadius * 0.8, 0]}>
          <circleGeometry args={[0.07, 8]} />
          <meshBasicMaterial color={item.status === 'specified' ? '#ff8c00' : '#ff3344'} />
        </mesh>
      )}
    </group>
  );
}
