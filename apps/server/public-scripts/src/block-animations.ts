(function () {
  "use strict";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const nodes = document.querySelectorAll<HTMLElement>('[data-jf-anim="in-view"]');
  if (!nodes.length) return;

  function play(el: HTMLElement): void {
    el.classList.remove("jf-anim--wait");
    el.classList.add("jf-anim--play");
  }

  function reset(el: HTMLElement): void {
    el.classList.remove("jf-anim--play");
    el.classList.add("jf-anim--wait");
  }

  if (!("IntersectionObserver" in window)) {
    nodes.forEach(play);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const el = entry.target as HTMLElement;
        if (entry.isIntersecting) {
          play(el);
          if (el.getAttribute("data-jf-anim-once") !== "0") observer.unobserve(el);
        } else if (el.getAttribute("data-jf-anim-once") === "0") {
          reset(el);
        }
      });
    },
    { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
  );

  nodes.forEach((el) => observer.observe(el));
})();
