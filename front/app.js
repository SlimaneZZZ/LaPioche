import { API_URL } from "./config.js";
import { api } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);

$("#docs-link").href = API_URL;

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const formatDate = (iso) => dateFormat.format(new Date(iso));

// Construit un élément sans jamais passer par innerHTML : les données de
// l'API (titres, noms) sont insérées comme du texte.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function button(label, onClick, className = "") {
  return el("button", { type: "button", class: className, onclick: onClick }, label);
}

function toast(message, isError = false) {
  const node = el("p", { class: isError ? "toast error" : "toast" }, message);
  $("#toasts").append(node);
  setTimeout(() => node.remove(), 5000);
}

// Exécute une action déclenchée par un bouton et affiche l'erreur de l'API.
async function run(action) {
  try {
    await action();
  } catch (error) {
    toast(error.message, true);
  }
}

function showFormError(dialog, error) {
  const target = $(".form-error", dialog);
  target.textContent = error ? error.message : "";
  target.hidden = !error;
}

for (const cancel of document.querySelectorAll("[data-cancel]")) {
  cancel.addEventListener("click", () => cancel.closest("dialog").close());
}

// Branche un formulaire de boîte de dialogue sur un appel à l'API.
// L'erreur renvoyée par l'API reste affichée dans la boîte, qui ne se ferme
// qu'en cas de succès.
function bindSubmit(dialog, form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError(dialog, null);
    try {
      await handler(new FormData(form));
      dialog.close();
      await refresh();
    } catch (error) {
      showFormError(dialog, error);
    }
  });
}

// --- Onglets ---------------------------------------------------------------

// Chaque onglet et la fonction qui charge son contenu.
const loaders = { games: () => loadGames(), members: () => loadMembers(), overdue: () => loadOverdue() };
const tabs = Object.keys(loaders);

function currentTab() {
  const name = location.hash.slice(1);
  return tabs.includes(name) ? name : "games";
}

async function refresh() {
  const tab = currentTab();
  for (const name of tabs) {
    $(`#${name}`).hidden = name !== tab;
    $(`[data-tab="${name}"]`).toggleAttribute("aria-current", name === tab);
  }
  await run(loaders[tab]);
  // Le compteur de retards reste visible quel que soit l'onglet affiché.
  await updateOverdueCount();
}

window.addEventListener("hashchange", refresh);

// --- Jeux ------------------------------------------------------------------

// --- Recherche de jeux

const searchForm = $("#game-filters");

// Un entier strictement positif, ou null : l'API refuserait toute autre valeur.
function positiveInteger(text) {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value > 0 ? value : null;
}

// Les critères à envoyer : un champ vide ou invalide est simplement ignoré.
function gameSearch() {
  const search = {};
  const q = searchForm.elements.q.value.trim();
  if (q) search.q = q;
  for (const name of ["players", "maxDuration"]) {
    const value = positiveInteger(searchForm.elements[name].value);
    if (value !== null) search[name] = value;
  }
  // Case décochée : aucun filtre (on ne demande pas « les jeux empruntés »).
  if (searchForm.elements.available.checked) search.available = true;
  return search;
}

// La liste se met à jour à chaque frappe, dans n'importe quel champ du formulaire.
searchForm.addEventListener("input", () => run(loadGames));
// Entrée dans un champ : pas de rechargement de la page.
searchForm.addEventListener("submit", (event) => event.preventDefault());
$("#reset-search").addEventListener("click", () => {
  searchForm.reset();
  run(loadGames);
});

// Numéro de la dernière recherche lancée : si l'on tape vite, les réponses
// peuvent arriver dans le désordre, et seule la plus récente doit s'afficher.
let latestGamesRequest = 0;

async function loadGames() {
  const search = gameSearch();
  const requestNumber = ++latestGamesRequest;
  const games = await api.listGames(search);
  if (requestNumber !== latestGamesRequest) return; // une recherche plus récente est partie entre-temps

  const isSearching = Object.keys(search).length > 0;
  $("#games-empty").hidden = games.length > 0 || isSearching;
  $("#games-no-match").hidden = games.length > 0 || !isSearching;
  $("#games-list").replaceChildren(...games.map(gameCard));
}

function gameCard(game) {
  const players =
    game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers} à ${game.maxPlayers}`;
  const status = game.isAvailable
    ? el("span", { class: "badge ok" }, "Disponible")
    : el("span", { class: "badge busy" }, "Emprunté");

  const actions = el("div", { class: "actions" });
  if (game.isAvailable) {
    actions.append(button("Emprunter", () => openBorrowDialog(game), "primary"));
  } else {
    actions.append(button("Rendre", () => returnGame(game), "primary"));
  }
  actions.append(
    button("Modifier", () => openGameDialog(game)),
    button("Supprimer", () => openDeleteGameDialog(game), "danger"),
  );

  return el(
    "li",
    { class: "card" },
    el("div", { class: "card-head" }, el("h3", {}, game.title), status),
    el("p", { class: "meta" }, `${players} joueur·ses · ${game.durationMinutes} min`),
    actions,
  );
}

const gameDialog = $("#game-dialog");
const gameForm = $("#game-form");
// Le même formulaire sert à l'ajout et à la modification :
// `editedGame` vaut null pour un ajout, le jeu modifié sinon.
let editedGame = null;

function openGameDialog(game = null) {
  editedGame = game;
  gameForm.reset();
  $("#game-dialog-title").textContent = game ? `Modifier « ${game.title} »` : "Ajouter un jeu";
  if (game) {
    const fields = gameForm.elements;
    fields.title.value = game.title;
    fields.minPlayers.value = game.minPlayers;
    fields.maxPlayers.value = game.maxPlayers;
    fields.durationMinutes.value = game.durationMinutes;
  }
  showFormError(gameDialog, null);
  gameDialog.showModal();
}

$("#add-game").addEventListener("click", () => openGameDialog());

bindSubmit(gameDialog, gameForm, (data) => {
  const game = {
    title: data.get("title").trim(),
    minPlayers: Number(data.get("minPlayers")),
    maxPlayers: Number(data.get("maxPlayers")),
    durationMinutes: Number(data.get("durationMinutes")),
  };
  return editedGame ? api.updateGame(editedGame.id, game) : api.createGame(game);
});

const deleteGameDialog = $("#delete-game-dialog");
const deleteGameForm = $("#delete-game-form");
let deletedGame = null;

function openDeleteGameDialog(game) {
  deletedGame = game;
  $("#delete-game-dialog-title").textContent = `Supprimer « ${game.title} » ?`;
  showFormError(deleteGameDialog, null);
  deleteGameDialog.showModal();
}

bindSubmit(deleteGameDialog, deleteGameForm, async () => {
  await api.deleteGame(deletedGame.id);
  toast(`« ${deletedGame.title} » a été supprimé.`);
});

// --- Emprunts --------------------------------------------------------------

const borrowDialog = $("#borrow-dialog");
const borrowForm = $("#borrow-form");
let borrowedGame = null;

async function openBorrowDialog(game) {
  await run(async () => {
    const members = await api.listMembers();
    if (members.length === 0) {
      toast("Ajoutez d'abord un·e adhérent·e pour pouvoir emprunter.", true);
      return;
    }
    borrowedGame = game;
    $("#borrow-dialog-title").textContent = `Emprunter « ${game.title} »`;
    $("select", borrowForm).replaceChildren(
      ...members.map((member) => el("option", { value: member.id }, `${member.name} (${member.email})`)),
    );
    showFormError(borrowDialog, null);
    borrowDialog.showModal();
  });
}

bindSubmit(borrowDialog, borrowForm, async (data) => {
  const loan = await api.borrow(borrowedGame.id, data.get("memberID"));
  toast(`« ${borrowedGame.title} » emprunté, à rendre avant le ${formatDate(loan.dueAt)}.`);
});

// L'API ne donne pas l'emprunt en cours d'un jeu : on parcourt les emprunts de
// chaque adhérent·e (GET /members/:id/loans) pour retrouver celui qui n'est pas rendu.
async function findOngoingLoan(game) {
  const members = await api.listMembers();
  const loansByMember = await Promise.all(members.map((member) => api.listMemberLoans(member.id)));
  // `returnedAt` est absent du JSON tant que l'emprunt n'est pas rendu.
  const loan = loansByMember.flat().find((loan) => loan.gameID === game.id && !loan.returnedAt);
  if (!loan) {
    throw new Error("Impossible de retrouver l'emprunt en cours de ce jeu.");
  }
  return loan;
}

async function returnGame(game) {
  await run(async () => {
    const loan = await findOngoingLoan(game);
    await api.returnLoan(loan.id);
    toast(`« ${game.title} » a été rendu.`);
    await refresh(); // met aussi à jour le compteur de retards
  });
}

// --- Emprunts en retard ------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000; // une journée en millisecondes

// Nombre de jours calendaires entre la date prévue et aujourd'hui (au moins 1).
function daysLate(dueAt, now = new Date()) {
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfDay(now) - startOfDay(new Date(dueAt))) / DAY);
  return Math.max(1, days);
}

function setOverdueCount(count) {
  const badge = $("#overdue-count");
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

// Le compteur est une information d'appoint : s'il ne peut pas être chargé,
// on le cache simplement, sans afficher d'erreur.
async function updateOverdueCount() {
  try {
    setOverdueCount((await api.listOverdueLoans()).length);
  } catch {
    $("#overdue-count").hidden = true;
  }
}

function overdueRow(loan, gameTitle, memberName) {
  const days = daysLate(loan.dueAt);
  return el(
    "li",
    { class: "row late" },
    el(
      "div",
      { class: "row-main" },
      el("p", {}, el("strong", {}, gameTitle)),
      el("p", { class: "meta" }, `${memberName} · retour prévu le ${formatDate(loan.dueAt)}`),
    ),
    // Le retard est écrit en toutes lettres : il ne repose pas sur la couleur seule.
    el("span", { class: "badge late" }, `${days} jour${days > 1 ? "s" : ""} de retard`),
  );
}

async function loadOverdue() {
  const [loans, games, members] = await Promise.all([api.listOverdueLoans(), api.listGames(), api.listMembers()]);
  const titles = new Map(games.map((game) => [game.id, game.title]));
  const names = new Map(members.map((member) => [member.id, member.name]));
  setOverdueCount(loans.length);
  $("#overdue-empty").hidden = loans.length > 0;
  $("#overdue-list").replaceChildren(
    ...loans.map((loan) => overdueRow(loan, titles.get(loan.gameID) ?? "Jeu inconnu", names.get(loan.memberID) ?? "Adhérent·e inconnu·e")),
  );
}

// --- Adhérent·es -----------------------------------------------------------

async function loadMembers() {
  const members = await api.listMembers();
  $("#members-empty").hidden = members.length > 0;
  $("#members-list").replaceChildren(...members.map(memberRow));
}

function memberRow(member) {
  return el(
    "li",
    { class: "row" },
    el("div", { class: "row-main" }, el("p", {}, el("strong", {}, member.name)), el("p", { class: "meta" }, member.email)),
    el(
      "div",
      { class: "actions" },
      button("Emprunts", () => openMemberLoans(member)),
      button("Modifier", () => openMemberDialog(member)),
      button("Supprimer", () => openDeleteMemberDialog(member), "danger"),
    ),
  );
}

const memberDialog = $("#member-dialog");
const memberForm = $("#member-form");
// Même principe que pour les jeux : null pour un ajout, l'adhérent·e modifié·e sinon.
let editedMember = null;

function openMemberDialog(member = null) {
  editedMember = member;
  memberForm.reset();
  $("#member-dialog-title").textContent = member ? `Modifier « ${member.name} »` : "Ajouter un·e adhérent·e";
  if (member) {
    memberForm.elements.name.value = member.name;
    memberForm.elements.email.value = member.email;
  }
  showFormError(memberDialog, null);
  memberDialog.showModal();
}

$("#add-member").addEventListener("click", () => openMemberDialog());

bindSubmit(memberDialog, memberForm, (data) => {
  const member = { name: data.get("name").trim(), email: data.get("email").trim() };
  return editedMember ? api.updateMember(editedMember.id, member) : api.createMember(member);
});

const deleteMemberDialog = $("#delete-member-dialog");
const deleteMemberForm = $("#delete-member-form");
let deletedMember = null;

function openDeleteMemberDialog(member) {
  deletedMember = member;
  $("#delete-member-dialog-title").textContent = `Supprimer « ${member.name} » ?`;
  showFormError(deleteMemberDialog, null);
  deleteMemberDialog.showModal();
}

bindSubmit(deleteMemberDialog, deleteMemberForm, async () => {
  await api.deleteMember(deletedMember.id);
  toast(`« ${deletedMember.name} » a été supprimé·e.`);
});

// --- Emprunts d'un·e adhérent·e --------------------------------------------

const memberLoansDialog = $("#member-loans-dialog");

// L'état n'est pas stocké : il se déduit des dates, comme la disponibilité côté API.
function loanState(loan, now = new Date()) {
  if (loan.returnedAt) return { label: "Rendu", badge: "ok", isLate: false };
  if (new Date(loan.dueAt) < now) return { label: "En retard", badge: "late", isLate: true };
  return { label: "En cours", badge: "busy", isLate: false };
}

function loanRow(loan, gameTitle) {
  const state = loanState(loan);
  const dates = [`Emprunté le ${formatDate(loan.borrowedAt)}`, `retour prévu le ${formatDate(loan.dueAt)}`];
  if (loan.returnedAt) dates.push(`rendu le ${formatDate(loan.returnedAt)}`);
  return el(
    "li",
    { class: state.isLate ? "row late" : "row" },
    el("div", { class: "row-main" }, el("p", {}, el("strong", {}, gameTitle)), el("p", { class: "meta" }, dates.join(" · "))),
    el("span", { class: `badge ${state.badge}` }, state.label),
  );
}

async function openMemberLoans(member) {
  await run(async () => {
    // Les emprunts ne contiennent que l'identifiant du jeu : on charge aussi les jeux pour afficher leur titre.
    const [loans, games] = await Promise.all([api.listMemberLoans(member.id), api.listGames()]);
    const titles = new Map(games.map((game) => [game.id, game.title]));
    $("#member-loans-title").textContent = `Emprunts de ${member.name}`;
    $("#member-loans-empty").hidden = loans.length > 0;
    $("#member-loans-list").replaceChildren(
      ...loans.map((loan) => loanRow(loan, titles.get(loan.gameID) ?? "Jeu inconnu")),
    );
    memberLoansDialog.showModal();
  });
}

refresh();
