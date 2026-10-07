// Model picker on the trackpad-holder page: choose an iPhone and a charging type, get the matching STL link and preview.
// First-party, no network calls, nothing stored; the choice is only mirrored into the URL hash so a link can be shared.
(() => {
  const root = document.querySelector(".picker");
  if (!root) return;
  const model = root.querySelector("#holder-model");
  const dl = root.querySelector("#holder-dl");
  const img = root.querySelector("#holder-img");
  const hint = root.querySelector("#holder-hint");
  const weak = root.querySelector("#holder-weak");
  const radios = [...root.querySelectorAll('input[name="holder-variant"]')];
  const variants = radios.map((r) => r.value).sort((a, b) => b.length - a.length);

  // #iphone-14-pro-max-wired -> model + variant
  const fromHash = () => {
    const hash = decodeURIComponent(location.hash.slice(1));
    const variant = variants.find((name) => hash.endsWith("-" + name));
    const id = variant && hash.slice(0, -(variant.length + 1));
    if (id && [...model.options].some((o) => o.value === id)) {
      model.value = id;
      radios.find((r) => r.value === variant).checked = true;
    }
  };

  const update = (remember) => {
    const option = model.selectedOptions[0];
    const available = option.dataset.v.split(" ");
    radios.forEach((r) => {
      r.disabled = !available.includes(r.value);
    });
    let current = radios.find((r) => r.checked);
    if (!current || current.disabled) {
      current = radios.find((r) => !r.disabled);
      current.checked = true;
    }
    const id = model.value;
    const variant = current.value;
    const file = id + "_" + variant + ".stl";
    dl.href = root.dataset.stl + variant + "/" + file;
    dl.download = file;

    const src = root.dataset.img + variant + "/" + id + ".webp";
    if (!img.src.endsWith(src)) {
      img.classList.add("is-changing");
      img.onload = img.onerror = () => img.classList.remove("is-changing");
      img.src = src;
    }
    img.alt = option.textContent + " · " + current.nextElementSibling.textContent;
    hint.textContent = (radios.some((r) => r.disabled) ? root.dataset.nomagsafe + " " : "") + current.dataset.hint;
    weak.hidden = !option.dataset.weak;
    if (remember) history.replaceState(null, "", "#" + id + "-" + variant);
  };

  model.addEventListener("change", () => update(true));
  radios.forEach((r) => r.addEventListener("change", () => update(true)));
  fromHash();
  update(false);
})();
