import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useToolchainStore } from '../store/toolchainStore';
import { StarNode } from './StarNode';
import { ConnectionLine } from './ConnectionLine';
import { ParticleFlow } from './ParticleFlow';

function TacticalGrid() {
  const rings = useMemo(() => {
    const result: { radius: number; y: number }[] = [];
    for (let r = 3; r <= 15; r += 3) {
      result.push({ radius: r, y: 0 });
    }
    return result;
  }, []);

  return (
    <group>
      {/* Range rings */}
      {rings.map((ring) => (
        <mesh key={`ring-${ring.radius}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, -4, 0]}>
          <ringGeometry args={[ring.radius - 0.02, ring.radius + 0.02, 64]} />
          <meshBasicMaterial color="#1a3a5c" transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Crosshairs */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -4, 0]}>
        <planeGeometry args={[30, 30]} />
        <meshBasicMaterial color="#0a1a2e" transparent opacity={0.15} depthWrite={false} />
      </mesh>

      {/* Vertical axis markers */}
      {[-8, -4, 0, 4, 8].map(y => (
        <mesh key={`h-${y}`} position={[0, y, 0]}>
          <ringGeometry args={[4.98, 5.02, 3]} />
          <meshBasicMaterial color="#1a3a5c" transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function BackgroundStars() {
  const particles = useMemo(() => {
    const count = 1500;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 200;
    return pos;
  }, []);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[particles, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.1} color="#1a3a5c" transparent opacity={0.4} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function Scene() {
  const items = useToolchainStore(s => s.items);
  const connections = useToolchainStore(s => s.connections);
  const selectedId = useToolchainStore(s => s.selectedItem);
  const hoveredId = useToolchainStore(s => s.hoveredItem);
  const selectItem = useToolchainStore(s => s.selectItem);
  const hoverItem = useToolchainStore(s => s.hoverItem);

  const itemMap = useMemo(() => {
    const m = new Map<string, typeof items[0]>();
    items.forEach(i => m.set(i.id, i));
    return m;
  }, [items]);

  const activeConnections = useMemo(() => {
    if (!selectedId) return [];
    return connections.filter(c => c.from === selectedId || c.to === selectedId);
  }, [connections, selectedId]);

  const controlsRef = useRef<any>(null);
  const lastSelectedId = useRef<string | null>(null);
  const isTransitioning = useRef(false);

  // Detect selection change
  if (selectedId !== lastSelectedId.current) {
    lastSelectedId.current = selectedId;
    isTransitioning.current = true;
  }

  useFrame((state) => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (selectedId) {
      const selectedNode = itemMap.get(selectedId);
      if (selectedNode) {
        const targetPos = new THREE.Vector3(selectedNode.position.x, selectedNode.position.y, selectedNode.position.z);
        
        if (isTransitioning.current) {
          // Lerp target
          controls.target.lerp(targetPos, 0.08);

          // Lerp camera position
          const offset = new THREE.Vector3(4, 2, 4);
          const desiredCamPos = targetPos.clone().add(offset);
          state.camera.position.lerp(desiredCamPos, 0.08);

          // If close enough, end transition
          if (controls.target.distanceTo(targetPos) < 0.05 && state.camera.position.distanceTo(desiredCamPos) < 0.1) {
            isTransitioning.current = false;
          }
          controls.update();
        } else {
          // Keep target locked to the node position in case the node itself is moving/transitioning layout!
          controls.target.copy(targetPos);
          controls.update();
        }
      }
    } else {
      if (isTransitioning.current) {
        const origin = new THREE.Vector3(0, 0, 0);
        controls.target.lerp(origin, 0.08);
        const defaultCamPos = new THREE.Vector3(14, 6, 14);
        state.camera.position.lerp(defaultCamPos, 0.08);

        if (controls.target.distanceTo(origin) < 0.05 && state.camera.position.distanceTo(defaultCamPos) < 0.1) {
          isTransitioning.current = false;
        }
        controls.update();
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 10, 5]} intensity={0.4} />

      {/* Sensor background grid */}
      <TacticalGrid />
      <BackgroundStars />

      {/* Connections */}
      {connections.map((conn, i) => (
        <ConnectionLine
          key={`conn-${i}`}
          from={itemMap.get(conn.from)}
          to={itemMap.get(conn.to)}
          type={conn.type}
          isActive={selectedId ? (conn.from === selectedId || conn.to === selectedId) : false}
        />
      ))}

      {/* Nodes */}
      {items.map(item => (
        <StarNode
          key={item.id}
          item={item}
          isSelected={selectedId === item.id}
          isHovered={hoveredId === item.id}
          onSelect={selectItem}
          onHover={hoverItem}
        />
      ))}

      {/* Background packet flow: slow and dim */}
      {connections.length > 0 && (
        <ParticleFlow
          connections={connections}
          itemMap={itemMap}
          speedMultiplier={0.15}
          opacity={0.25}
          size={0.03}
          color="#1a5080"
        />
      )}

      {/* Active surge packet flow: fast and bright */}
      {activeConnections.length > 0 && (
        <ParticleFlow
          connections={activeConnections}
          itemMap={itemMap}
          speedMultiplier={1.0}
          opacity={0.9}
          size={0.06}
          color="#00d4ff"
        />
      )}

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        autoRotate={!selectedId && !isTransitioning.current}
        autoRotateSpeed={0.2}
        minDistance={3}
        maxDistance={30}
        target={[0, 0, 0]}
      />

      <EffectComposer>
        <Bloom luminanceThreshold={0.3} luminanceSmoothing={0.85} intensity={0.4} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export default function Constellation() {
  return (
    <Canvas
      camera={{ position: [14, 6, 14], fov: 45, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.8 }}
      style={{ position: 'absolute', inset: 0 }}
      onPointerMissed={() => useToolchainStore.getState().selectItem(null)}
    >
      <color attach="background" args={['#040b14']} />
      <Scene />
    </Canvas>
  );
}
