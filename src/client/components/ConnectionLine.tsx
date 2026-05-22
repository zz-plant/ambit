import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { Item } from '../utils/configImporter';

interface Props {
  from?: Item;
  to?: Item;
  type: string;
  isActive: boolean;
}

export function ConnectionLine({ from, to, isActive }: Props) {
  if (!from || !to) return null;

  const start = new THREE.Vector3(from.position.x, from.position.y, from.position.z);
  const end = new THREE.Vector3(to.position.x, to.position.y, to.position.z);

  const points = useMemo(() => {
    const p: THREE.Vector3[] = [];
    const segments = 24;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const pt = new THREE.Vector3().lerpVectors(start, end, t);
      // Slight arc
      const arc = Math.sin(t * Math.PI) * 0.5;
      pt.y += arc;
      p.push(pt);
    }
    return p;
  }, [from, to]);

  const curve = useMemo(() => new THREE.CatmullRomCurve3(points), [points]);

  const baseGeo = useMemo(() => new THREE.TubeGeometry(curve, 20, 0.02, 4, false), [curve]);

  return (
    <mesh geometry={baseGeo}>
      <meshBasicMaterial
        color={isActive ? '#00d4ff' : '#1a3050'}
        transparent
        opacity={isActive ? 0.7 : 0.25}
        depthWrite={false}
      />
    </mesh>
  );
}
