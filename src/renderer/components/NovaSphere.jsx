import React, { useEffect, useRef } from 'react';

export default function NovaSphere({ state = 'idle', audioLevel = 0.18 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const width = (canvas.width = 680);
    const height = (canvas.height = 360);

    let angle = 0;
    const waveformPoints = 48;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;

      let coreColor = '#ff7b00';
      let ringColor = 'rgba(255, 130, 0, 0.7)';
      let glowColor = 'rgba(255, 120, 0, 0.4)';
      let speed = 0.015;

      if (state === 'listening') {
        coreColor = '#ff9900';
        ringColor = 'rgba(255, 160, 0, 0.9)';
        glowColor = 'rgba(255, 140, 0, 0.6)';
        speed = 0.035;
      } else if (state === 'thinking') {
        coreColor = '#00f0ff';
        ringColor = 'rgba(0, 240, 255, 0.8)';
        glowColor = 'rgba(0, 240, 255, 0.5)';
        speed = 0.06;
      } else if (state === 'speaking') {
        coreColor = '#ffaa00';
        ringColor = 'rgba(255, 190, 0, 1)';
        glowColor = 'rgba(255, 170, 0, 0.8)';
        speed = 0.025;
      }

      angle += speed;

      // 1. Background Grid Lines
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 120, 0, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 40; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 30; y < height; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();

      // 2. Central Concentric Amber Rings
      const ringRadii = [40, 65, 88, 110];
      ringRadii.forEach((radius, idx) => {
        ctx.save();
        ctx.beginPath();
        // بولتے وقت دائرے ارتعاش کریں گے
        const pulse = audioLevel > 0.25 ? Math.sin(Date.now() / 120 + idx) * (audioLevel * 8) : 0;
        ctx.arc(centerX, centerY, radius + pulse, 0, Math.PI * 2);

        if (idx === 1) {
          ctx.setLineDash([4, 6]);
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 1.5;
        } else if (idx === 2) {
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
          ctx.lineWidth = 1.2;
        } else {
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = idx === 0 ? 2 : 1;
        }

        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 15;
        ctx.stroke();
        ctx.restore();
      });

      // 3. Orbiting Nodes
      const orbitNodes = [
        { r: 65, spd: angle * 1.5, col: '#ffaa00' },
        { r: 88, spd: -angle * 1.2, col: '#00e5ff' },
        { r: 110, spd: angle * 0.8, col: '#ff7700' }
      ];
      orbitNodes.forEach((node) => {
        const nx = centerX + Math.cos(node.spd) * node.r;
        const ny = centerY + Math.sin(node.spd) * node.r;
        ctx.save();
        ctx.beginPath();
        ctx.arc(nx, ny, 3, 0, Math.PI * 2);
        ctx.fillStyle = node.col;
        ctx.shadowColor = node.col;
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.restore();
      });

      // 4. Horizontal Audio Equalizer Spectrum (طاقتور لائیو لہریں)
      ctx.save();
      // جب آواز آئے گی تو لہریں اوپر نیچے اونچی ناچیں گی
      const waveAmplitude = audioLevel > 0.22 ? audioLevel * 85 : 8;
      const barWidth = 3;
      const spacing = (width - 80) / waveformPoints;

      for (let i = 0; i < waveformPoints; i++) {
        const x = 40 + i * spacing;
        const distFromCenter = Math.abs(x - centerX);

        if (distFromCenter < 35) continue;

        const factor = Math.sin((i / waveformPoints) * Math.PI);
        const dynamicH = Math.max(3, Math.sin(angle * 5 + i * 0.45) * waveAmplitude * factor);

        const grad = ctx.createLinearGradient(x, centerY - dynamicH, x, centerY + dynamicH);
        grad.addColorStop(0, '#ffaa00');
        grad.addColorStop(0.5, '#ff5500');
        grad.addColorStop(1, '#ffaa00');

        ctx.fillStyle = grad;
        ctx.shadowColor = 'rgba(255, 120, 0, 0.8)';
        ctx.shadowBlur = 8;
        ctx.fillRect(x, centerY - dynamicH, barWidth, dynamicH * 2);
      }
      ctx.restore();

      // 5. Center Microphone Capsule
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, 28, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16, 18, 26, 0.9)';
      ctx.strokeStyle = coreColor;
      ctx.lineWidth = 2;
      ctx.shadowColor = coreColor;
      ctx.shadowBlur = 20;
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = coreColor;
      ctx.fillStyle = coreColor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.shadowColor = coreColor;
      ctx.shadowBlur = 10;

      ctx.beginPath();
      ctx.roundRect(centerX - 4.5, centerY - 11, 9, 14, 4.5);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY - 4, 8, 0, Math.PI);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(centerX, centerY + 4);
      ctx.lineTo(centerX, centerY + 10);
      ctx.moveTo(centerX - 5, centerY + 10);
      ctx.lineTo(centerX + 5, centerY + 10);
      ctx.stroke();
      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [state, audioLevel]);

  return (
    <div className="relative flex items-center justify-center w-full h-full select-none pointer-events-none">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
