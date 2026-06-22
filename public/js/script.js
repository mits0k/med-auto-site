document.addEventListener("DOMContentLoaded", function () {
  /* ===== Mobile nav toggle ===== */
  const navToggle = document.querySelector(".nav-toggle");
  const navLinks = document.getElementById("primary-nav");
  if (navToggle && navLinks) {
    const closeNav = () => {
      navLinks.classList.remove("open");
      navToggle.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
      navToggle.setAttribute("aria-label", navToggle.dataset.openLabel || "Open navigation menu");
    };

    navToggle.addEventListener("click", () => {
      const isOpen = navLinks.classList.toggle("open");
      navToggle.classList.toggle("open", isOpen);
      navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      navToggle.setAttribute("aria-label", isOpen ? (navToggle.dataset.closeLabel || "Close navigation menu") : (navToggle.dataset.openLabel || "Open navigation menu"));
    });

    navLinks.querySelectorAll("a").forEach(a => {
      const linkPath = new URL(a.href, window.location.origin).pathname.replace(/\/$/, "") || "/";
      const currentPath = window.location.pathname.replace(/\/$/, "") || "/";
      if (linkPath === currentPath) a.setAttribute("aria-current", "page");
      a.addEventListener("click", closeNav);
    });

    document.addEventListener("click", (event) => {
      if (!navLinks.contains(event.target) && !navToggle.contains(event.target)) closeNav();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && navLinks.classList.contains("open")) {
        closeNav();
        navToggle.focus();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 900) closeNav();
    });
  }

  /* ===== Lightbox & gallery ===== */
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.querySelector(".lightbox-img");
  const closeBtn = document.querySelector(".close");
  const nextBtn = document.querySelector(".next");
  const prevBtn = document.querySelector(".prev");
  const galleryNextBtn = document.querySelector(".gallery-next");
  const galleryPrevBtn = document.querySelector(".gallery-prev");
  const galleryExpandBtn = document.querySelector(".gallery-expand");
  const galleryCounter = document.getElementById("galleryCounter");
  const lightboxCounter = document.querySelector(".lightbox-counter");
  const galleryMain = document.querySelector(".gallery-main");

  // New: main image + thumbs (if present on this page)
  const mainImage = document.getElementById("mainImage");
  const thumbs = document.querySelectorAll(".thumb");

  // Build images array for the lightbox:
  let images = [];
  if (mainImage) {
    images = Array.from(thumbs).map(t => t.src);
    if (images.length === 0) images = [mainImage.src];
  } else {
    images = Array.from(document.querySelectorAll(".gallery-img")).map(i => i.src);
  }

  let currentIndex = 0;

  function updateCounter(counter) {
    if (!counter || images.length === 0) return;
    const label = galleryCounter ? galleryCounter.textContent.split(" ")[0] : "Photo";
    counter.textContent = `${label} ${currentIndex + 1} / ${images.length}`;
  }

  function openLightbox(index) {
    if (index < 0) index = images.length - 1;
    if (index >= images.length) index = 0;
    currentIndex = index;
    if (lightboxImg) lightboxImg.src = images[currentIndex];
    updateCounter(lightboxCounter);
    if (lightbox) {
      lightbox.classList.add("open");
      lightbox.style.display = "flex";
    }
  }

  function showIndex(index) {
    if (index < 0) index = images.length - 1;
    if (index >= images.length) index = 0;
    currentIndex = index;

    if (mainImage) {
      mainImage.src = images[currentIndex];
      mainImage.setAttribute("data-index", String(currentIndex));
      thumbs.forEach(t => t.classList.remove("active"));
      const active = Array.from(thumbs).find(t => Number(t.dataset.index) === currentIndex);
      if (active) {
        active.classList.add("active");
        active.closest(".thumb-button")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
    updateCounter(galleryCounter);
  }

  // Thumbnail click -> swap main image (no lightbox)
  thumbs.forEach(t => {
    const trigger = t.closest(".thumb-button") || t;
    trigger.addEventListener("click", () => {
      showIndex(Number(t.dataset.index));
    });
  });

  // Click main image -> open lightbox at that index
  if (mainImage) {
    mainImage.addEventListener("click", () => {
      openLightbox(Number(mainImage.dataset.index || 0));
    });
  } else {
    // Old layout support
    document.querySelectorAll(".gallery-img").forEach((img, i) => {
      img.addEventListener("click", () => openLightbox(i));
    });
  }

  if (galleryNextBtn) galleryNextBtn.addEventListener("click", () => showIndex(currentIndex + 1));
  if (galleryPrevBtn) galleryPrevBtn.addEventListener("click", () => showIndex(currentIndex - 1));
  if (galleryExpandBtn) galleryExpandBtn.addEventListener("click", () => openLightbox(currentIndex));

  // Lightbox controls
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      if (lightbox) {
        lightbox.classList.remove("open");
        lightbox.style.display = "none";
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      openLightbox(currentIndex + 1);
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      openLightbox(currentIndex - 1);
    });
  }

  // Close lightbox when clicking outside the image
  if (lightbox) {
    lightbox.addEventListener("click", (e) => {
      if (e.target === lightbox) {
        lightbox.classList.remove("open");
        lightbox.style.display = "none";
      }
    });
  }

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (lightbox && lightbox.classList.contains("open")) {
      if (e.key === "ArrowLeft") openLightbox(currentIndex - 1);
      if (e.key === "ArrowRight") openLightbox(currentIndex + 1);
      if (e.key === "Escape") {
        lightbox.classList.remove("open");
        lightbox.style.display = "none";
      }
    } else {
      // Not in lightbox: quick swap main image
      if (mainImage) {
        if (e.key === "ArrowLeft") showIndex(currentIndex - 1);
        if (e.key === "ArrowRight") showIndex(currentIndex + 1);
      }
    }
  });

  // Mobile swipe support for both the main gallery and full-screen viewer.
  let startX = 0;
  function enableSwipe(element, changeImage) {
    if (!element) return;
    element.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
    }, { passive: true });
    element.addEventListener("touchend", (e) => {
      const endX = e.changedTouches[0].clientX;
      if (startX - endX > 50) changeImage(currentIndex + 1);
      if (endX - startX > 50) changeImage(currentIndex - 1);
    });
  }
  enableSwipe(lightbox, openLightbox);
  enableSwipe(galleryMain, showIndex);
});
