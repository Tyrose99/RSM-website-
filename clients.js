/*
  RSM CLIENTS — the orbit carousel in the Athletes section is built from this list.

  To add a client:
    1. Put their photo in /assets/img/ (portrait 4:5 works best, e.g. 1100x1375; .webp, .jpg or .png).
    2. Copy one entry below, paste it at the end of the list and fill it in.
       - name:      shown under the photo
       - photo:     the file name in /assets/img/
       - instagram: their handle without the @ (leave "" to hide it)
       - sport / detail: optional extra lines (leave "" to hide them)
       - video / poster (optional): a clip in /assets/video/ and a still frame in /assets/img/,
         e.g. video: "their-name.mp4", poster: "their-name-poster.webp".
         Adding these turns the card into a "Tap to flip" card with the video on the back.
  That's it. The orbit adjusts to however many clients are listed.
*/
window.RSM_CLIENTS = [
  {
    name: "Chris Brown",
    photo: "chris-brown.webp",
    instagram: "",
    sport: "Football",
    detail: "WR #1 · Moravian University",
    video: "christopher-brown.mp4",
    poster: "christopher-brown-poster.webp",
  },
  {
    name: "Mohammed Masoud",
    photo: "moe-masoud.webp",
    instagram: "",
    sport: "Basketball",
    detail: "Jordan National Team",
    video: "moe-masoud.mp4",
    poster: "moe-masoud-poster.webp",
  },
];
