fetch('/content/settings.json')
  .then(res => res.json())
  .then(data => {
    // 1. Dynamic Favicon
    if (data.favicon) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = data.favicon;
    }

    // 2. Google Analytics 4 (GA4)
    const gaId = data.ga_id || 'G-ZDT6SZL4KR';
    if (gaId && gaId.startsWith('G-')) {
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
      document.head.appendChild(script);

      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', gaId);
    }
  })
  .catch(err => console.error('Settings load error:', err));
