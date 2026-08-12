import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Item, Connection } from '../utils/configImporter';

interface Props {
  from?: Item;
  to?: Item;
  type: string;
  isActive: boolean;
}

/** Slight upward arc so overlapping links stay distinguishable. */
function arcPoints(from: Item, to: Item): THREE.Vector3[] {
  const start = new THREE.Vector3(from.position.x, from.position.y, from.position.z);
  const end = new THREE.Vector3(to.position.x, to.position.y, to.position.z);
  const p: THREE.Vector3[] = [];
  const segments = 24;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const pt = new THREE.Vector3().lerpVectors(start, end, t);
    pt.y += Math.sin(t * Math.PI) * 0.5;
    p.push(pt);
  }
  return p;
}

export function ConnectionLine({ from, to, isActive }: Props) {
  const baseGeo = useMemo(() => {
    if (!from || !to) return null;
    const curve = new THREE.CatmullRomCurve3(arcPoints(from, to));
    return new THREE.TubeGeometry(curve, 20, 0.02, 4, false);
  }, [from, to]);

  if (!baseGeo) return null;

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

interface PacketFlowProps {
  connections: Connection[];
  itemMap: Map<string, Item>;
  speedMultiplier: number;
  opacity: number;
  size: number;
  color: string;
}

/**
 * Animated packets travelling along every connection, drawn as a single
 * instanced mesh so hundreds of links cost one draw call.
 */
export function PacketFlow({ connections, itemMap, speedMultiplier, opacity, size, color }: PacketFlowProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // One curve per resolvable connection, plus a phase offset so packets on
  // different links do not travel in lockstep.
  const curves = useMemo(() => {
    const result: { curve: THREE.CatmullRomCurve3; phase: number }[] = [];
    connections.forEach((conn, i) => {
      const from = itemMap.get(conn.from);
      const to = itemMap.get(conn.to);
      if (!from || !to) return;
      result.push({
        curve: new THREE.CatmullRomCurve3(arcPoints(from, to)),
        phase: (i * 0.6180339887) % 1,
      });
    });
    return result;
  }, [connections, itemMap]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.getElapsedTime() * speedMultiplier * 0.25;
    curves.forEach(({ curve, phase }, i) => {
      const point = curve.getPointAt((t + phase) % 1);
      dummy.position.copy(point);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (curves.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, curves.length]} frustumCulled={false}>
      <sphereGeometry args={[size, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </instancedMesh>
  );
}
