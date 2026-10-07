// How-to video on the home page: the chips jump to a scene and the current scene's chip is highlighted.
// First-party, no network calls, nothing stored.
(() => {
  const video = document.querySelector("#howto");
  const chips = [...document.querySelectorAll(".chip[data-t]")];
  if (!video || !chips.length) return;
  const starts = chips.map((c) => Number(c.dataset.t));
  chips.forEach((chip, i) => {
    chip.addEventListener("click", () => {
      video.currentTime = starts[i];
      video.play().catch(() => {});
    });
  });
  const mark = () => {
    const now = video.currentTime;
    const current = starts.reduce((acc, t, i) => (now >= t - 0.05 ? i : acc), -1);
    chips.forEach((c, i) => c.classList.toggle("is-current", i === current));
  };
  video.addEventListener("timeupdate", mark);
  video.addEventListener("seeked", mark);
})();
