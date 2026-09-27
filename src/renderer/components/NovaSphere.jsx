import React, { useEffect, useRef } from 'react';

export default function NovaSphere({ state = 'idle', audioLevel = 0.2 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    let width = (canvas.width = 620);
    let height = (canvas.height = 540);

    let angleX = 0;
    let angleY = 0;
    let blinkTimer = 0;
    let eyeBlinkProgress = 0; // 0 = open, 1 = closed

    const particles = Array.from({ length: 65 }, () => ({
      x: (Math.random() - 0.5) * 260,
      y: (Math.random() - 0.5) * 260,
      z: (Math.random() - 0.5) * 260,
      radius: Math.random() * 2 + 1,
      speed: Math.random() * 0.015 + 0.005,
      color: Math.random() > 0.4 ? '#00f0ff' : '#a855f7'
    }));

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const centerX = width / 2;
      const centerY = height / 2 - 25;

      // State dynamic speeds and colors
      let speedMultiplier = 1;
      let coreColorStart = '#00f0ff';
      let coreColorEnd = '#9333ea';
      let eyeGlow = '#00f0ff';

      if (state === 'thinking') {
        speedMultiplier = 2.8;
        coreColorStart = '#a855f7';
        coreColorEnd = '#ec4899';
        eyeGlow = '#f43f5e';
      } else if (state === 'speaking') {
        speedMultiplier = 1.6;
        coreColorStart = '#38bdf8';
        coreColorEnd = '#6366f1';
        eyeGlow = '#38bdf8';
      } else if (state === 'listening') {
        speedMultiplier = 1.2;
        coreColorStart = '#06b6d4';
        coreColorEnd = '#3b82f6';
        eyeGlow = '#22d3ee';
      }

      angleY += 0.012 * speedMultiplier;
      angleX += 0.006 * speedMultiplier;

      // 1. Perspective Holographic Pedestal (Concentric Rings on the Floor)
      const pedestalY = centerY + 175;
      for (let r = 3; r >= 1; r--) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(centerX, pedestalY + r * 6, 170 - r * 28, (170 - r * 28) * 0.28, 0, 0, Math.PI * 2);
        ctx.strokeStyle = r === 1 ? 'rgba(0, 240, 255, 0.75)' : 'rgba(147, 51, 234, 0.35)';
        ctx.lineWidth = r === 1 ? 2.5 : 1.5;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = r === 1 ? 16 : 8;
        ctx.stroke();
        ctx.restore();
      }

      // Vertical Pedestal Light Rays / Upward Cone Glow
      const beamGrad = ctx.createLinearGradient(centerX, pedestalY, centerX, centerY + 40);
      beamGrad.addColorStop(0, 'rgba(0, 240, 255, 0.22)');
      beamGrad.addColorStop(0.5, 'rgba(147, 51, 234, 0.1)');
      beamGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(centerX - 130, pedestalY);
      ctx.lineTo(centerX + 130, pedestalY);
      ctx.lineTo(centerX + 50, centerY + 50);
      ctx.lineTo(centerX - 50, centerY + 50);
      ctx.closePath();
      ctx.fill();

      // 2. Swirling Orbit Particles
      particles.forEach((p) => {
        const radY = angleY * p.speed * 80;
        const radX = angleX * p.speed * 80;

        let cosY = Math.cos(radY);
        let sinY = Math.sin(radY);
        let x1 = p.x * cosY - p.z * sinY;
        let z1 = p.z * cosY + p.x * sinY;

        let cosX = Math.cos(radX);
        let sinX = Math.sin(radX);
        let y2 = p.y * cosX - z1 * sinX;
        let z2 = z1 * cosX + p.y * sinX;

        const fov = 350;
        const scale = fov / (fov + z2 + 200);
        const projX = centerX + x1 * scale;
        const projY = centerY + y2 * scale;

        ctx.save();
        ctx.beginPath();
        ctx.arc(projX, projY, Math.max(0.5, p.radius * scale), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.globalAlpha = Math.min(1, Math.max(0.2, (z2 + 200) / 400));
        ctx.fill();
        ctx.restore();
      });

      // 3. Inclined 3D Holographic Orbit Rings
      const ringScale = 1 + Math.sin(Date.now() / 600) * 0.03 + (state === 'speaking' ? audioLevel * 0.2 : 0);
      for (let i = 0; i < 2; i++) {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(i === 0 ? 0.38 : -0.45);
        ctx.beginPath();
        ctx.ellipse(0, 0, 155 * ringScale, 55 * ringScale, i === 0 ? angleY : -angleY * 1.3, 0, Math.PI * 2);
        ctx.strokeStyle = i === 0 ? 'rgba(0, 240, 255, 0.65)' : 'rgba(168, 85, 247, 0.65)';
        ctx.lineWidth = 1.8;
        ctx.shadowColor = i === 0 ? '#00f0ff' : '#a855f7';
        ctx.shadowBlur = 14;
        ctx.setLineDash([12, 10]);
        ctx.stroke();
        ctx.restore();
      }

      // 4. Central Hologram Glowing Orb Core
      const baseRadius = 88;
      const pulse = state === 'speaking' ? baseRadius + audioLevel * 35 : baseRadius + Math.sin(Date.now() / 450) * 4;

      const coreGradient = ctx.createRadialGradient(
        centerX - 20,
        centerY - 25,
        10,
        centerX,
        centerY,
        pulse
      );
      coreGradient.addColorStop(0, '#ffffff');
      coreGradient.addColorStop(0.25, coreColorStart);
      coreGradient.addColorStop(0.7, coreColorEnd);
      coreGradient.addColorStop(1, 'rgba(3, 7, 18, 0.1)');

      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulse, 0, Math.PI * 2);
      ctx.fillStyle = coreGradient;
      ctx.shadowColor = coreColorStart;
      ctx.shadowBlur = 45;
      ctx.fill();
      ctx.restore();

      // Outer Translucent Glass Bubble Rim
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 20;
      ctx.stroke();
      ctx.restore();

      // 5. Expressive Holographic Vertical Capsule Eyes
      blinkTimer++;
      if (blinkTimer > 180 && blinkTimer < 192) {
        eyeBlinkProgress = (blinkTimer - 180) / 12;
      } else if (blinkTimer >= 192 && blinkTimer < 204) {
        eyeBlinkProgress = 1 - (blinkTimer - 192) / 12;
      } else if (blinkTimer >= 204) {
        blinkTimer = 0;
        eyeBlinkProgress = 0;
      }

      const eyeWidth = 14;
      const eyeBaseHeight = 44;
      const dynamicEyeHeight = Math.max(
        3,
        (state === 'speaking' ? eyeBaseHeight + audioLevel * 14 : eyeBaseHeight) * (1 - eyeBlinkProgress)
      );
      const eyeSpacing = 24;

      [-eyeSpacing, eyeSpacing].forEach((offset) => {
        ctx.save();
        ctx.beginPath();
        const eyeX = centerX + offset - eyeWidth / 2;
        const eyeY = centerY - dynamicEyeHeight / 2;
        ctx.roundRect(eyeX, eyeY, eyeWidth, dynamicEyeHeight, eyeWidth / 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = eyeGlow;
        ctx.shadowBlur = 24;
        ctx.fill();

        // Inner glowing core of eyes
        ctx.beginPath();
        ctx.roundRect(eyeX + 2, eyeY + 2, eyeWidth - 4, Math.max(1, dynamicEyeHeight - 4), (eyeWidth - 4) / 2);
        ctx.fillStyle = eyeGlow;
        ctx.fill();
        ctx.restore();
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [state, audioLevel]);

  return (
    <div className="relative flex items-center justify-center w-full h-full select-none pointer-events-none">
      <canvas ref={canvasRef} className="max-w-full max-h-full" />
    </div>
  );
}
