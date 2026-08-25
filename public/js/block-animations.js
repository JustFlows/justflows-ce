(function () {
  "use strict";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var nodes = document.querySelectorAll('[data-jf-anim="in-view"]');
  if (!nodes.length) return;

  function play(el) {
    el.classList.remove("jf-anim--wait");
    el.classList.add("jf-anim--play");
  }

  function reset(el) {
    el.classList.remove("jf-anim--play");
    el.classList.add("jf-anim--wait");
  }

  if (!("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(nodes, play);
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        var el = entry.target;
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

  Array.prototype.forEach.call(nodes, function (el) {
    observer.observe(el);
  });
})();
