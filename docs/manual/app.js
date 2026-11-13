(function () {
  var dlg = document.getElementById('viewer');
  var img = document.getElementById('viewer-img');
  var cap = document.getElementById('viewer-cap');
  document.querySelectorAll('.frame button[data-full]').forEach(function (b) {
    b.addEventListener('click', function () {
      var inner = b.querySelector('img');
      img.src = b.getAttribute('data-full');
      img.alt = inner ? inner.alt : '';
      var fig = b.closest('figure');
      var fc = fig ? fig.querySelector('figcaption') : null;
      cap.textContent = fc ? fc.textContent : (inner ? inner.alt : '');
      if (dlg.showModal) dlg.showModal();
    });
  });
  document.getElementById('viewer-close').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  var links = Array.prototype.slice.call(document.querySelectorAll('#toc-list a'));
  var sections = links.map(function (a) { return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) links.forEach(function (l) { l.classList.toggle('on', l.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-15% 0px -75% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  }
})();
