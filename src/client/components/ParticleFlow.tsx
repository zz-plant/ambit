import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Item, Connection } from '../utils/configImporter';

interface Props {
  connections: Connection[];
  itemMap: Map<string, Item>;
  speedMultiplier?: number;
  opacity?: number;
  size?: number;
  color?: string;
}

const PACKETS_PER_LINK = 10;

export function ParticleFlow({
  connections,
  itemMap,
  speedMultiplier = 1.0,
  opacity = 0.8,
  size = 0.05,
  color = '#00d4ff'
}: Props) {
  const meshRef = useRef<THREE.Points>(null);

  const system = useMemo<{
    positions: Float32Array;
    speeds: Float32Array;
    offsets: Float32Array;
    connIdx: Float32Array;
  } | null>(() => {
    const valid = connections.filter(c => itemMap.has(c.from) && itemMap.has(c.to));
    if (valid.length === 0) return null;
    const total = valid.length * PACKETS_PER_LINK;
    const positions = new Float32Array(total * 3);
    const speeds = new Float32Array(total);
    const offsets = new Float32Array(total);
    const connIdx = new Float32Array(total);

    let idx = 0;
    for (let ci = 0; ci < valid.length; ci++) {
      const c = valid[ci];
      const from = itemMap.get(c.from)!;
      const to = itemMap.get(c.to)!;
      const s = new THREE.Vector3(from.position.x, from.position.y, from.position.z);
      const e = new THREE.Vector3(to.position.x, to.position.y, to.position.z);

      for (let p = 0; p < PACKETS_PER_LINK; p++) {
        const t = p / PACKETS_PER_LINK;
        const pt = new THREE.Vector3().lerpVectors(s, e, t);
        pt.y += Math.sin(t * Math.PI) * 0.5;
        positions[idx * 3] = pt.x;
        positions[idx * 3 + 1] = pt.y;
        positions[idx * 3 + 2] = pt.z;
        speeds[idx] = (0.3 + Math.random() * 0.5) * speedMultiplier;
        offsets[idx] = Math.random();
        connIdx[idx] = ci;
        idx++;
      }
    }
    return { positions, speeds, offsets, connIdx };
  }, [connections, itemMap, speedMultiplier]);

  useFrame((_, delta) => {
    if (!meshRef.current || !system) return;
    const pos = meshRef.current.geometry.attributes.position.array as Float32Array;
    const valid = connections.filter(c => itemMap.has(c.from) && itemMap.has(c.to));

    for (let i = 0; i < system.offsets.length; i++) {
      const ci = Math.round(system.connIdx[i]);
      if (ci >= valid.length) continue;
      const c = valid[ci];
      const from = itemMap.get(c.from)!;
      const to = itemMap.get(c.to)!;
      const s = new THREE.Vector3(from.position.x, from.position.y, from.position.z);
      const e = new THREE.Vector3(to.position.x, to.position.y, to.position.z);

      system.offsets[i] += delta * system.speeds[i];
      if (system.offsets[i] > 1) system.offsets[i] -= 1;

      const t = system.offsets[i];
      const pt = new THREE.Vector3().lerpVectors(s, e, t);
      pt.y += Math.sin(t * Math.PI) * 0.5;
      pos[i * 3] = pt.x;
      pos[i * 3 + 1] = pt.y;
      pos[i * 3 + 2] = pt.z;
    }
    meshRef.current.geometry.attributes.position.needsUpdate = true;
  });

  if (!system) return null;

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[system.positions, 3]}
          count={system.positions.length / 3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        color={color}
        transparent
        opacity={opacity}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}
