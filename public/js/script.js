document.addEventListener("DOMContentLoaded", function () {
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.querySelector(".lightbox-img");
  const closeBtn = document.querySelector(".close");
  const nextBtn = document.querySelector(".next");
  const prevBtn = document.querySelector(".prev");

  // New: main image + thumbs (if present on this page)
  const mainImage = document.getElementById("mainImage");
  const thumbs = document.querySelectorAll(".thumb");

  // Build images array for the lightbox:
  // - If new gallery exists: from thumbnails (or main as fallback)
  // - Else: fall back to old .gallery-img grid (other pages)
  let images = [];
  if (mainImage) {
    images = Array.from(thumbs).map(t => t.src);
    if (images.length === 0) images = [mainImage.src];
  } else {
    images = Array.from(document.querySelectorAll(".gallery-img")).map(i => i.src);
  }

  let currentIndex = 0;

  function openLightbox(index) {
    if (index < 0) index = images.length - 1;
    if (index >= images.length) index = 0;
    currentIndex = index;
    lightboxImg.src = images[currentIndex];
    lightbox.style.display = "flex";
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
      if (active) active.classList.add("active");
    }
  }

  // Thumbnail click -> swap main image (no lightbox)
  thumbs.forEach(t => {
    t.addEventListener("click", () => {
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

  // Lightbox controls
  closeBtn.addEventListener("click", () => {
    lightbox.style.display = "none";
  });
  nextBtn.addEventListener("click", () => {
    openLightbox(currentIndex + 1);
  });
  prevBtn.addEventListener("click", () => {
    openLightbox(currentIndex - 1);
  });

  // Close lightbox when clicking outside the image
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
      lightbox.style.display = "none";
    }
  });

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (lightbox.style.display === "flex") {
      if (e.key === "ArrowLeft") openLightbox(currentIndex - 1);
      if (e.key === "ArrowRight") openLightbox(currentIndex + 1);
      if (e.key === "Escape") lightbox.style.display = "none";
    } else {
      // Not in lightbox: quick swap main image
      if (mainImage) {
        if (e.key === "ArrowLeft") showIndex(currentIndex - 1);
        if (e.key === "ArrowRight") showIndex(currentIndex + 1);
      }
    }
  });

  // Mobile swipe support (lightbox)
  let startX = 0;
  lightbox.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
  });
  lightbox.addEventListener("touchend", (e) => {
    const endX = e.changedTouches[0].clientX;
    if (startX - endX > 50) openLightbox(currentIndex + 1); // left
    if (endX - startX > 50) openLightbox(currentIndex - 1); // right
  });
});
