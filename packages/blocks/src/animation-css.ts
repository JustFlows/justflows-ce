// SPDX-License-Identifier: MIT

/** Public-site CSS for page-builder animations. Injected into `/theme.css`. */
export const BLOCK_ANIMATION_CSS = `
.jf-anim {
  --jf-anim-duration: 0.6s;
  --jf-anim-delay: 0s;
  animation-duration: var(--jf-anim-duration);
  animation-delay: var(--jf-anim-delay);
  animation-fill-mode: backwards;
  animation-timing-function: ease-out;
}
.jf-anim-ease-ease-in { animation-timing-function: ease-in; }
.jf-anim-ease-ease-in-out { animation-timing-function: ease-in-out; }
.jf-anim-ease-linear { animation-timing-function: linear; }
.jf-anim-ease-spring { animation-timing-function: cubic-bezier(0.22, 1.2, 0.36, 1); }

.jf-anim--wait.jf-anim-e-fade { opacity: 0; }
.jf-anim--wait.jf-anim-e-fade-up { opacity: 0; transform: translate3d(0, 28px, 0); }
.jf-anim--wait.jf-anim-e-fade-down { opacity: 0; transform: translate3d(0, -28px, 0); }
.jf-anim--wait.jf-anim-e-fade-left { opacity: 0; transform: translate3d(28px, 0, 0); }
.jf-anim--wait.jf-anim-e-fade-right { opacity: 0; transform: translate3d(-28px, 0, 0); }
.jf-anim--wait.jf-anim-e-slide-up { transform: translate3d(0, 48px, 0); }
.jf-anim--wait.jf-anim-e-slide-down { transform: translate3d(0, -48px, 0); }
.jf-anim--wait.jf-anim-e-slide-left { transform: translate3d(48px, 0, 0); }
.jf-anim--wait.jf-anim-e-slide-right { transform: translate3d(-48px, 0, 0); }
.jf-anim--wait.jf-anim-e-zoom-in { opacity: 0; transform: scale(0.92); }
.jf-anim--wait.jf-anim-e-zoom-out { opacity: 0; transform: scale(1.08); }
.jf-anim--wait.jf-anim-e-bounce { opacity: 0; transform: translate3d(0, 40px, 0); }
.jf-anim--wait.jf-anim-e-flip-x { opacity: 0; transform: perspective(900px) rotateX(70deg); }
.jf-anim--wait.jf-anim-e-flip-y { opacity: 0; transform: perspective(900px) rotateY(70deg); }
.jf-anim--wait.jf-anim-e-rotate { opacity: 0; transform: rotate(-12deg); }
.jf-anim--wait.jf-anim-e-blur { opacity: 0; filter: blur(12px); }

.jf-anim--play.jf-anim-e-fade { animation-name: jf-anim-fade; }
.jf-anim--play.jf-anim-e-fade-up { animation-name: jf-anim-fade-up; }
.jf-anim--play.jf-anim-e-fade-down { animation-name: jf-anim-fade-down; }
.jf-anim--play.jf-anim-e-fade-left { animation-name: jf-anim-fade-left; }
.jf-anim--play.jf-anim-e-fade-right { animation-name: jf-anim-fade-right; }
.jf-anim--play.jf-anim-e-slide-up { animation-name: jf-anim-slide-up; }
.jf-anim--play.jf-anim-e-slide-down { animation-name: jf-anim-slide-down; }
.jf-anim--play.jf-anim-e-slide-left { animation-name: jf-anim-slide-left; }
.jf-anim--play.jf-anim-e-slide-right { animation-name: jf-anim-slide-right; }
.jf-anim--play.jf-anim-e-zoom-in { animation-name: jf-anim-zoom-in; }
.jf-anim--play.jf-anim-e-zoom-out { animation-name: jf-anim-zoom-out; }
.jf-anim--play.jf-anim-e-bounce { animation-name: jf-anim-bounce; }
.jf-anim--play.jf-anim-e-flip-x { animation-name: jf-anim-flip-x; }
.jf-anim--play.jf-anim-e-flip-y { animation-name: jf-anim-flip-y; }
.jf-anim--play.jf-anim-e-rotate { animation-name: jf-anim-rotate; }
.jf-anim--play.jf-anim-e-blur { animation-name: jf-anim-blur; }

@keyframes jf-anim-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes jf-anim-fade-up { from { opacity: 0; transform: translate3d(0, 28px, 0); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-fade-down { from { opacity: 0; transform: translate3d(0, -28px, 0); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-fade-left { from { opacity: 0; transform: translate3d(28px, 0, 0); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-fade-right { from { opacity: 0; transform: translate3d(-28px, 0, 0); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-slide-up { from { transform: translate3d(0, 48px, 0); } to { transform: none; } }
@keyframes jf-anim-slide-down { from { transform: translate3d(0, -48px, 0); } to { transform: none; } }
@keyframes jf-anim-slide-left { from { transform: translate3d(48px, 0, 0); } to { transform: none; } }
@keyframes jf-anim-slide-right { from { transform: translate3d(-48px, 0, 0); } to { transform: none; } }
@keyframes jf-anim-zoom-in { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-zoom-out { from { opacity: 0; transform: scale(1.08); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-bounce {
  from { opacity: 0; transform: translate3d(0, 40px, 0); }
  60% { opacity: 1; transform: translate3d(0, -8px, 0); }
  to { opacity: 1; transform: none; }
}
@keyframes jf-anim-flip-x { from { opacity: 0; transform: perspective(900px) rotateX(70deg); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-flip-y { from { opacity: 0; transform: perspective(900px) rotateY(70deg); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-rotate { from { opacity: 0; transform: rotate(-12deg); } to { opacity: 1; transform: none; } }
@keyframes jf-anim-blur { from { opacity: 0; filter: blur(12px); } to { opacity: 1; filter: none; } }

.jf-anim-h-grow,
.jf-anim-h-shrink,
.jf-anim-h-lift,
.jf-anim-h-glow,
.jf-anim-h-tilt,
.jf-anim-h-brighten,
.jf-anim-t-press,
.jf-anim-t-pulse {
  transition: transform 0.35s ease, box-shadow 0.35s ease, filter 0.35s ease;
}
@media (hover: hover) {
  .jf-anim-h-grow:hover { transform: scale(1.04); }
  .jf-anim-h-shrink:hover { transform: scale(0.97); }
  .jf-anim-h-lift:hover { transform: translate3d(0, -6px, 0); }
  .jf-anim-h-glow:hover { box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16); }
  .jf-anim-h-tilt:hover { transform: rotate(2deg); }
  .jf-anim-h-brighten:hover { filter: brightness(1.08); }
}
.jf-anim-t-press:active { transform: scale(0.97); }
.jf-anim-t-pulse:active { transform: scale(1.04); }

@media (prefers-reduced-motion: reduce) {
  .jf-anim,
  .jf-anim--wait,
  .jf-anim--play {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
    filter: none !important;
  }
  .jf-anim-h-grow:hover,
  .jf-anim-h-shrink:hover,
  .jf-anim-h-lift:hover,
  .jf-anim-h-tilt:hover,
  .jf-anim-t-press:active,
  .jf-anim-t-pulse:active {
    transform: none !important;
  }
}
`.trim();
