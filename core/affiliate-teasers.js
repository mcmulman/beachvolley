(function () {
  'use strict';

  var products = [
    {
      asin: 'B07Z6VQ2ZG',
      titleKey: 'home.affiliate.ball.title',
      title: 'Wilson OPTX Beachvolleyball',
      descriptionKey: 'home.affiliate.ball.description',
      description: 'Ein gut sichtbarer Beachvolleyball für Training und Spiel am Strand.',
      altKey: 'home.affiliate.ball.alt',
      alt: 'Wilson OPTX Beachvolleyball',
      image: 'https://m.media-amazon.com/images/I/8111KcIjdIL._AC_SL1500_.jpg'
    },
    {
      asin: 'B0F3284NK7',
      titleKey: 'home.affiliate.socks.title',
      title: 'Neoprensocken für Beachvolleyball',
      descriptionKey: 'home.affiliate.socks.description',
      description: 'Schützen die Füße vor heißem Sand und kaltem Untergrund.',
      altKey: 'home.affiliate.socks.alt',
      alt: 'Beachvolleyball-Neoprensocken',
      image: 'https://m.media-amazon.com/images/I/61wAAWBj8HL._AC_SL1080_.jpg'
    },
    {
      asin: '3964160601',
      titleKey: 'home.affiliate.book.title',
      title: 'Beach-Volleyball: Übungen für Gewinner',
      descriptionKey: 'home.affiliate.book.description',
      description: 'Trainingsideen und Übungen für abwechslungsreiche Beachvolleyball-Einheiten.',
      altKey: 'home.affiliate.book.alt',
      alt: 'Beach-Volleyball: Übungen für Gewinner',
      image: 'https://m.media-amazon.com/images/I/71VNHnabFSL._SL1436_.jpg'
    }
  ];

  function translate(key, fallback) {
    return typeof TI18n !== 'undefined' && TI18n ? TI18n.t(key) : fallback;
  }

  function localize(node, key, fallback) {
    node.textContent = translate(key, fallback);
    node.setAttribute('data-i18n', key);
  }

  function makeSection() {
    var section = document.createElement('section');
    section.className = 'affiliate-section noprint';
    section.id = 'affiliate-recommendations';
    section.setAttribute('aria-labelledby', 'affiliate-heading');

    var heading = document.createElement('h2');
    heading.className = 'affiliate-heading';
    heading.id = 'affiliate-heading';
    localize(heading, 'home.affiliate.heading', 'Empfehlungen für dein Beachvolleyball-Turnier');
    section.appendChild(heading);

    var disclosure = document.createElement('p');
    disclosure.className = 'affiliate-disclosure';
    localize(disclosure, 'home.affiliate.disclosure',
      'Als Amazon-Partner verdiene ich an qualifizierten Verkäufen. Preise und Verfügbarkeit können sich ändern.');
    section.appendChild(disclosure);

    var grid = document.createElement('div');
    grid.className = 'affiliate-grid';
    products.forEach(function (product) {
      var link = document.createElement('a');
      link.className = 'affiliate-card';
      link.setAttribute('data-amazon-asin', product.asin);
      link.href = 'https://www.amazon.de/dp/' + product.asin + '?tag=klicktips02-21';
      link.target = '_blank';
      link.rel = 'nofollow noopener sponsored';

      var imageWrap = document.createElement('span');
      imageWrap.className = 'affiliate-image-wrap';
      var image = document.createElement('img');
      image.className = 'affiliate-image';
      image.src = product.image;
      image.alt = translate(product.altKey, product.alt);
      image.setAttribute('data-i18n-attr', 'alt:' + product.altKey);
      image.loading = 'lazy';
      imageWrap.appendChild(image);
      link.appendChild(imageWrap);

      var copy = document.createElement('span');
      copy.className = 'affiliate-copy';
      var title = document.createElement('strong');
      title.className = 'affiliate-title';
      title.setAttribute('data-i18n', product.titleKey);
      title.textContent = translate(product.titleKey, product.title);
      copy.appendChild(title);

      var description = document.createElement('span');
      description.className = 'affiliate-description';
      description.setAttribute('data-i18n', product.descriptionKey);
      description.textContent = translate(product.descriptionKey, product.description);
      copy.appendChild(description);

      var price = document.createElement('span');
      price.className = 'affiliate-price';
      price.setAttribute('data-i18n', 'home.affiliate.price.loading');
      price.textContent = translate('home.affiliate.price.loading', 'Preis wird geladen …');
      copy.appendChild(price);

      var priceNote = document.createElement('span');
      priceNote.className = 'affiliate-price-note';
      copy.appendChild(priceNote);

      var cta = document.createElement('span');
      cta.className = 'affiliate-link-label';
      cta.setAttribute('data-i18n', 'home.affiliate.cta');
      cta.textContent = translate('home.affiliate.cta', 'Bei Amazon ansehen ↗');
      copy.appendChild(cta);
      link.appendChild(copy);
      grid.appendChild(link);
    });
    section.appendChild(grid);

    var updated = document.createElement('p');
    updated.className = 'affiliate-updated';
    updated.id = 'affiliate-updated';
    updated.hidden = true;
    section.appendChild(updated);
    return section;
  }

  function unavailable(cards) {
    cards.forEach(function (card) {
      var price = card.querySelector('.affiliate-price');
      var note = card.querySelector('.affiliate-price-note');
      if (price) price.textContent = translate(
        'home.affiliate.price.unavailable', 'Preis aktuell nicht verfügbar'
      );
      if (note) note.textContent = translate(
        'home.affiliate.price.checkAmazon', 'Bitte aktuellen Preis bei Amazon prüfen.'
      );
    });
  }

  function hidePrices(cards) {
    cards.forEach(function (card) {
      ['.affiliate-price', '.affiliate-price-note'].forEach(function (selector) {
        var node = card.querySelector(selector);
        if (node) {
          node.textContent = '';
          node.removeAttribute('data-i18n');
          node.hidden = true;
        }
      });
    });
  }

  function loadPrices(section, endpoint) {
    var cards = section.querySelectorAll('.affiliate-card[data-amazon-asin]');
    if (!cards.length) return;
    if (location.protocol === 'file:' || !navigator.onLine) {
      hidePrices(cards);
      return;
    }

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () {
      if (controller) controller.abort();
    }, 10000);
    fetch(endpoint, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error('Amazon product feed unavailable.');
      return response.json();
    }).then(function (data) {
      cards.forEach(function (card) {
        var product = data.products && data.products[card.getAttribute('data-amazon-asin')];
        var price = card.querySelector('.affiliate-price');
        var note = card.querySelector('.affiliate-price-note');
        var image = card.querySelector('.affiliate-image');
        if (!product) {
          unavailable([card]);
          return;
        }
        if (typeof product.title === 'string' && product.title) {
          card.querySelector('.affiliate-title').textContent = product.title;
        }
        if (typeof product.imageUrl === 'string') {
          try {
            var imageUrl = new URL(product.imageUrl);
            if (imageUrl.protocol === 'https:' && /\.media-amazon\.com$/.test(imageUrl.hostname)) {
              var fallbackImage = image.src;
              image.onerror = function () {
                image.onerror = null;
                image.src = fallbackImage;
              };
              image.src = imageUrl.href;
            }
          } catch (error) {
            // Keep the original Amazon-hosted image if the API URL is invalid.
          }
        }
        var displayPrice = product.price && product.price.display;
        if (!displayPrice && product.price && Number.isFinite(Number(product.price.amount))
            && typeof product.price.currency === 'string') {
          try {
            displayPrice = new Intl.NumberFormat(
              typeof TI18n !== 'undefined' && TI18n ? TI18n.locale() : 'de-DE',
              { style: 'currency', currency: product.price.currency }
            ).format(Number(product.price.amount));
          } catch (error) {
            displayPrice = '';
          }
        }
        if (typeof displayPrice === 'string' && displayPrice) {
          price.textContent = displayPrice;
          note.textContent = '';
        } else {
          unavailable([card]);
        }
      });
      var updated = section.querySelector('.affiliate-updated');
      var timestamp = new Date(data.lastUpdated);
      if (updated && !Number.isNaN(timestamp.getTime())) {
        updated.textContent = translate('home.affiliate.price.updated', 'Zuletzt aktualisiert:')
          + ' ' + timestamp.toLocaleString(
            typeof TI18n !== 'undefined' && TI18n ? TI18n.locale() : 'de-DE'
          );
        updated.hidden = false;
      }
    }).catch(function () {
      hidePrices(cards);
    }).finally(function () {
      clearTimeout(timeout);
    });
  }

  var section = document.getElementById('affiliate-recommendations');
  if (!section) {
    section = makeSection();
    var footer = document.querySelector('footer');
    if (footer && footer.parentNode) footer.parentNode.insertBefore(section, footer);
    else document.body.appendChild(section);
  }

  loadPrices(section, 'https://beachvolley.klickdienst-server.de/api/amazon_products.php');
})();
