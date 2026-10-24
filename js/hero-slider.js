/**
 * Rawgadz Hero Section Slider Component (Alpine.js)
 * Loads images and videos dynamically from hero.json
 * Supports autoplay, swipe/touch gestures, controls, indicators, and smooth crossfades
 */

function heroSlider(pageKey = 'index') {
  // Built-in resilient fallback slides in case hero.json is loading or offline
  const fallbackMap = {
    index: [
      {
        type: 'image',
        src: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?q=80&w=2000&auto=format&fit=crop',
        alt: 'Next Gen Tech Showcase'
      },
      {
        type: 'video',
        src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        poster: 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?q=80&w=2000&auto=format&fit=crop',
        alt: 'Tech Innovation in Motion'
      },
      {
        type: 'image',
        src: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=2000&auto=format&fit=crop',
        alt: 'Premium Minimalist Audio'
      },
      {
        type: 'video',
        src: 'https://www.youtube.com/watch?v=kU_tEwQ6Z_E',
        poster: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?q=80&w=2000&auto=format&fit=crop',
        alt: 'Precision Engineering Video'
      }
    ],
    gadgets: [
      {
        type: 'image',
        src: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?q=80&w=2000&auto=format&fit=crop',
        alt: 'Curated Minimalist Gadgets'
      },
      {
        type: 'video',
        src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        poster: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=2000&auto=format&fit=crop',
        alt: 'Smart Devices Video'
      },
      {
        type: 'image',
        src: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?q=80&w=2000&auto=format&fit=crop',
        alt: 'Minimalist Smart Wearables'
      },
      {
        type: 'image',
        src: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?q=80&w=2000&auto=format&fit=crop',
        alt: 'Mechanical Keyboards & Studio Gear'
      }
    ],
    car: [
      {
        type: 'image',
        src: 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?q=80&w=2000&auto=format&fit=crop',
        alt: 'Track Performance Machine'
      },
      {
        type: 'video',
        src: 'https://www.youtube.com/watch?v=kU_tEwQ6Z_E',
        poster: 'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?q=80&w=2000&auto=format&fit=crop',
        alt: 'Track Lap Video'
      },
      {
        type: 'image',
        src: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2000&auto=format&fit=crop',
        alt: 'Electric Hypercar Showcase'
      },
      {
        type: 'video',
        src: 'https://www.youtube.com/watch?v=DyKQ7qtTJag',
        poster: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?q=80&w=2000&auto=format&fit=crop',
        alt: 'Rimac Nevera Acceleration'
      }
    ]
  };

  const initial = fallbackMap[pageKey] || fallbackMap['index'] || [];

  return {
    pageKey: pageKey,
    slides: [...initial],
    currentIndex: 0,
    autoplayTimer: null,
    autoplayInterval: 5000,
    touchStartX: 0,
    touchEndX: 0,
    loading: true,

    async init() {
      await this.loadHeroData();
      this.startAutoplay();
      this.$watch('currentIndex', () => {
        this.handleSlideChange();
      });
    },

    async loadHeroData() {
      try {
        const res = await fetch('/data/hero.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        let pageSlides = null;
        if (Array.isArray(data)) {
          pageSlides = data;
        } else if (data && typeof data === 'object') {
          const key = (this.pageKey || 'index').toLowerCase();
          pageSlides = data[key]
            || (key === 'gadgets' ? (data['gadget'] || data['gadgets.html']) : null)
            || (key === 'car' ? (data['cars'] || data['car.html']) : null)
            || (key === 'cars' ? (data['car'] || data['car.html']) : null)
            || (key === 'index' ? (data['home'] || data['index.html']) : null)
            || data['default'];
        }

        if (Array.isArray(pageSlides) && pageSlides.length > 0) {
          this.slides = pageSlides;
          if (this.currentIndex >= this.slides.length) {
            this.currentIndex = 0;
          }
        }
      } catch (err) {
        console.warn(`[heroSlider] hero.json load failed for '${this.pageKey}', using fallbacks:`, err);
      } finally {
        this.loading = false;
      }
    },

    nextSlide() {
      if (this.slides.length <= 1) return;
      this.currentIndex = (this.currentIndex + 1) % this.slides.length;
      this.resetAutoplay();
    },

    prevSlide() {
      if (this.slides.length <= 1) return;
      this.currentIndex = (this.currentIndex - 1 + this.slides.length) % this.slides.length;
      this.resetAutoplay();
    },

    goToSlide(index) {
      if (index >= 0 && index < this.slides.length) {
        this.currentIndex = index;
        this.resetAutoplay();
      }
    },

    startAutoplay() {
      this.stopAutoplay();
      if (this.slides.length > 1) {
        this.autoplayTimer = setInterval(() => {
          this.nextSlide();
        }, this.autoplayInterval);
      }
    },

    stopAutoplay() {
      if (this.autoplayTimer) {
        clearInterval(this.autoplayTimer);
        this.autoplayTimer = null;
      }
    },

    resetAutoplay() {
      this.stopAutoplay();
      this.startAutoplay();
    },

    handleSlideChange() {
      this.$nextTick(() => {
        const container = this.$el;
        if (!container) return;
        const activeSlideEl = container.querySelector(`[data-slide-index="${this.currentIndex}"]`);
        if (activeSlideEl) {
          const video = activeSlideEl.querySelector('video');
          if (video) {
            video.currentTime = 0;
            video.play().catch(() => {});
          }
        }
      });
    },

    handleTouchStart(e) {
      if (e.touches && e.touches.length > 0) {
        this.touchStartX = e.touches[0].clientX;
      }
    },

    handleTouchEnd(e) {
      if (e.changedTouches && e.changedTouches.length > 0) {
        this.touchEndX = e.changedTouches[0].clientX;
        const diff = this.touchStartX - this.touchEndX;
        if (Math.abs(diff) > 40) {
          if (diff > 0) {
            this.nextSlide();
          } else {
            this.prevSlide();
          }
        }
      }
    },

    isVideo(slide) {
      if (!slide) return false;
      if (slide.type === 'video') return true;
      if (slide.type === 'image') return false;
      const url = slide.src || slide.url || slide.video || '';
      return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) || this.isYoutube(slide);
    },

    isYoutube(slide) {
      if (!slide) return false;
      const url = slide.src || slide.url || slide.video || '';
      return /(?:youtube\.com|youtu\.be)/i.test(url);
    },

    getYoutubeEmbedUrl(url) {
      if (!url) return '';
      const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
      const videoId = match ? match[1] : url;
      return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoId}&playsinline=1&rel=0&modestbranding=1&enablejsapi=1`;
    }
  };
}

// Global & Alpine integration
if (typeof window !== 'undefined') {
  window.heroSlider = heroSlider;
  if (window.Alpine) {
    window.Alpine.data('heroSlider', heroSlider);
  } else {
    document.addEventListener('alpine:init', () => {
      window.Alpine.data('heroSlider', heroSlider);
    });
  }
}
