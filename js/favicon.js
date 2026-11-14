fetch('/content/settings.json')
  .then(res => res.json())
  .then(data => {
    if (data.favicon) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = data.favicon;
    }
  })
  .catch(err => console.error('Favicon load error:', err));
