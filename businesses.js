/*
  RSM BUSINESSES — the "Businesses We Work With" orbit in the Businesses section is built from this list.

  To add a business:
    1. Put their logo in /assets/img/ (a transparent background looks best; .webp, .png or .jpg).
    2. Copy one entry below, paste it at the end of the list and fill it in.
       - name:      shown in bold at the bottom of the poster
       - logo:      the file name in /assets/img/
       - tag:       short line under the name (leave "" to hide it)
       - instagram: their handle without the @, e.g. instagram: "kosportstv" (leave "" to hide it).
         It shows as a floating Instagram link under their card.
       - video / poster (optional): a clip in /assets/video/ and a still frame in /assets/img/.
         Adding these turns the card into a "Tap to flip" card with the video on the back.
  That's it. The orbit adjusts to however many businesses are listed.
*/
window.RSM_BUSINESSES = [
  {
    name: "LLMD",
    logo: "llmd-mobile-detailing.webp",
    tag: "Mobile Detailing",
    instagram: "loves_luxurydetailing",
    video: "llmd-mobile-detailing.mp4",
    poster: "llmd-mobile-detailing-poster.webp",
  },
  {
    name: "KOSPORTSTV",
    logo: "kosportstv.webp",
    tag: "Training & Performance",
    instagram: "kosportstv",
    video: "ko-sports-clip.mp4",
    poster: "ko-sports-clip-poster.webp",
  },
  {
    name: "STT",
    logo: "set-the-tone.webp",
    tag: "Lacrosse Events & Training",
    instagram: "setthetonelacrosse",
  },
];
