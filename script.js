const accordionHeaders = document.querySelectorAll(".ques");

accordionHeaders.forEach((header) => {
  header.addEventListener("click", () => {
    const popup = document.querySelector(`#p${header.id}`);
    const img1 = document.querySelector(`#ip${header.id}`);
    const img2 = document.querySelector(`#ic${header.id}`);
    const accordionitem = document.querySelectorAll(".ques");
    accordionitem.forEach((item) => {
      if (item.id != header.id) {
        const popup = document.querySelector(`#p${item.id}`);
        const img1 = document.querySelector(`#ip${header.id}`);
        const img2 = document.querySelector(`#ic${header.id}`);
        popup.classList.add("hidden");
        img1.classList.remove("hidden")
        img2.classList.add("hidden")
      }
    });
    if (popup.classList == "popup hidden") {
      popup.classList.remove("hidden");
      img1.classList.add("hidden")
      img2.classList.remove("hidden")
    } else {
      popup.classList.add("hidden");
      img1.classList.remove("hidden")
      img2.classList.add("hidden")
    }
  });
});
