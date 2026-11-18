import { assertEqual, assertIncludes, assertTrue, test, waitFor } from "./runner.js";
import { mountApp } from "./helpers.js";

const catan = { id: "g1", title: "Catan", minPlayers: 3, maxPlayers: 4, durationMinutes: 90, isAvailable: true };
const dixit = { id: "g2", title: "Dixit", minPlayers: 3, maxPlayers: 6, durationMinutes: 30, isAvailable: false };
const camille = { id: "m1", name: "Camille", email: "camille@example.com" };

const cardOf = (app, title) => app.$$("#games-list .card").find((card) => card.querySelector("h3").textContent === title);

// --- Jeux

test("games list shows one card per game with its availability", async () => {
  const app = await mountApp({ "GET /games": [catan, dixit] });
  await waitFor(() => app.$$("#games-list .card").length === 2, "deux cartes de jeu");
  assertIncludes(cardOf(app, "Catan").textContent, "Disponible");
  assertIncludes(cardOf(app, "Dixit").textContent, "Emprunté");
  assertIncludes(cardOf(app, "Catan").textContent, "3 à 4 joueur·ses · 90 min");
});

test("only an available game offers Borrow", async () => {
  const app = await mountApp({ "GET /games": [catan, dixit] });
  await waitFor(() => app.$$("#games-list .card").length === 2);
  const labels = (title) => [...cardOf(app, title).querySelectorAll("button")].map((button) => button.textContent);
  assertTrue(labels("Catan").includes("Emprunter"), "Catan devrait proposer Emprunter");
  assertTrue(!labels("Dixit").includes("Emprunter"), "Dixit est emprunté, il ne doit pas proposer Emprunter");
});

test("with no game, a message invites to add one", async () => {
  const app = await mountApp({ "GET /games": [] });
  await waitFor(() => !app.$("#games-empty").hidden);
  assertIncludes(app.$("#games-empty").textContent, "ne contient aucun jeu");
  assertIncludes(app.$("#games-empty").textContent, "Ajouter un jeu");
});

test("the search sends the title, the players and the max duration, and ignores invalid values", async () => {
  const app = await mountApp({ "GET /games": [catan, dixit] });
  await waitFor(() => app.$$("#games-list .card").length === 2);
  const fields = app.$("#game-filters").elements;
  app.type(fields.q, " cat ");
  app.type(fields.players, "4");
  app.type(fields.maxDuration, "60");
  await waitFor(() => app.calls.at(-1).search === "?q=cat&players=4&maxDuration=60", "les trois critères envoyés");

  // Des valeurs que l'API refuserait ne sont jamais envoyées.
  for (const invalid of ["0", "-3", "2.5"]) {
    app.type(fields.players, invalid);
    await waitFor(() => app.calls.at(-1).search === "?q=cat&maxDuration=60", `« ${invalid} » ignoré`);
  }
});

test("a search without result has its own message, and the reset button shows every game again", async () => {
  const app = await mountApp({ "GET /games?q=zzz": [], "GET /games": [catan, dixit] });
  await waitFor(() => app.$$("#games-list .card").length === 2);
  app.type(app.$("#game-filters").elements.q, "zzz");
  await waitFor(() => !app.$("#games-no-match").hidden, "message de recherche sans résultat");
  assertIncludes(app.$("#games-no-match").textContent, "Aucun jeu ne correspond");
  assertTrue(app.$("#games-empty").hidden, "le message de ludothèque vide ne doit pas s'afficher");
  assertEqual(app.$$("#games-list .card").length, 0);

  app.click("Réinitialiser");
  await waitFor(() => app.$$("#games-list .card").length === 2, "tous les jeux de nouveau");
  assertEqual(app.$("#game-filters").elements.q.value, "");
  assertEqual(app.calls.at(-1).search, "");
  assertTrue(app.$("#games-no-match").hidden, "le message de recherche disparaît");
});

test("adding a game posts the form then reloads the list", async () => {
  const app = await mountApp({ "GET /games": [catan], "POST /games": [201, { ...catan, id: "g3", title: "Dixit" }] });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Ajouter un jeu");
  const form = app.$("#game-form");
  form.elements.title.value = "  Dixit ";
  form.elements.minPlayers.value = "3";
  form.elements.maxPlayers.value = "6";
  form.elements.durationMinutes.value = "30";
  form.requestSubmit();
  await waitFor(() => app.calls.some((call) => call.method === "POST" && call.path === "/games"), "l'appel POST /games");
  assertEqual(app.calls.find((call) => call.method === "POST").body, {
    title: "Dixit",
    minPlayers: 3,
    maxPlayers: 6,
    durationMinutes: 30,
  });
  await waitFor(() => !app.$("#game-dialog").open, "la boîte se ferme");
});

test("a validation error is shown in French and the dialog stays open", async () => {
  const app = await mountApp({
    "GET /games": [],
    "POST /games": [400, { error: true, reason: "title is empty, durationMinutes is less than minimum of 1" }],
  });
  await waitFor(() => !app.$("#games-empty").hidden, "la page est chargée");
  app.click("Ajouter un jeu");
  app.$("#game-form").requestSubmit();
  await waitFor(() => !app.$("#game-dialog .form-error").hidden, "le message d'erreur");
  assertEqual(app.$("#game-dialog .form-error").textContent, "Le titre est obligatoire. La durée doit être d'au moins 1.");
  assertTrue(app.$("#game-dialog").open, "la boîte devrait rester ouverte");
});

test("editing a game opens a prefilled form and sends a PUT", async () => {
  const app = await mountApp({ "GET /games": [catan], "PUT /games/g1": { ...catan, title: "Catan Junior" } });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Modifier", cardOf(app, "Catan"));
  await waitFor(() => app.$("#game-dialog").open, "la boîte de modification");
  const form = app.$("#game-form");
  assertEqual(app.$("#game-dialog-title").textContent, "Modifier « Catan »");
  assertEqual(form.elements.title.value, "Catan");
  assertEqual(form.elements.durationMinutes.value, "90");
  form.elements.title.value = "Catan Junior";
  form.requestSubmit();
  await waitFor(() => app.calls.some((call) => call.method === "PUT"), "l'appel PUT /games/g1");
  const put = app.calls.find((call) => call.method === "PUT");
  assertEqual(put.path, "/games/g1");
  assertEqual(put.body, { title: "Catan Junior", minPlayers: 3, maxPlayers: 4, durationMinutes: 90 });
  await waitFor(() => !app.$("#game-dialog").open, "la boîte se ferme");
});

test("adding a game after an edit starts from an empty form", async () => {
  const app = await mountApp({ "GET /games": [catan] });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Modifier", cardOf(app, "Catan"));
  app.click("Annuler", app.$("#game-dialog"));
  app.click("Ajouter un jeu");
  assertEqual(app.$("#game-dialog-title").textContent, "Ajouter un jeu");
  assertEqual(app.$("#game-form").elements.title.value, "");
});

test("deleting a game asks for confirmation, then removes it from the list", async () => {
  let games = [catan, dixit];
  const app = await mountApp({
    "GET /games": () => games,
    "DELETE /games/g1": () => {
      games = [dixit];
      return [204];
    },
  });
  await waitFor(() => app.$$("#games-list .card").length === 2);
  app.click("Supprimer", cardOf(app, "Catan"));
  await waitFor(() => app.$("#delete-game-dialog").open, "la confirmation");
  assertIncludes(app.$("#delete-game-dialog-title").textContent, "Catan");
  assertTrue(!app.calls.some((call) => call.method === "DELETE"), "rien ne doit partir avant la confirmation");
  app.click("Supprimer", app.$("#delete-game-dialog"));
  await waitFor(() => app.$$("#games-list .card").length === 1, "Catan disparaît de la liste");
  assertTrue(!cardOf(app, "Catan"), "la carte de Catan ne doit plus exister");
  assertTrue(!app.$("#delete-game-dialog").open, "la confirmation se ferme");
});

test("a game with a loan history cannot be deleted: French message, confirmation stays open", async () => {
  const app = await mountApp({
    "GET /games": [catan],
    "DELETE /games/g1": [409, { error: true, reason: "A game with loans cannot be deleted" }],
  });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Supprimer", cardOf(app, "Catan"));
  app.click("Supprimer", app.$("#delete-game-dialog"));
  await waitFor(() => !app.$("#delete-game-dialog .form-error").hidden, "le message d'erreur");
  assertIncludes(app.$("#delete-game-dialog .form-error").textContent, "historique d'emprunts");
  assertTrue(app.$("#delete-game-dialog").open, "la confirmation devrait rester ouverte");
});

// --- Emprunts

test("borrowing a game sends the game and the chosen member", async () => {
  const app = await mountApp({
    "GET /games": [catan],
    "GET /members": [camille],
    "POST /loans": [201, { id: "l1", gameID: "g1", memberID: "m1", borrowedAt: new Date().toISOString(), dueAt: new Date().toISOString() }],
  });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Emprunter", cardOf(app, "Catan"));
  await waitFor(() => app.$("#borrow-dialog").open, "la boîte d'emprunt");
  app.$("#borrow-form").requestSubmit();
  await waitFor(() => app.calls.some((call) => call.method === "POST" && call.path === "/loans"), "l'appel POST /loans");
  assertEqual(app.calls.find((call) => call.path === "/loans").body, { gameID: "g1", memberID: "m1" });
  await waitFor(() => app.$("#toasts").textContent.includes("emprunté"), "le message de confirmation");
});

test("borrowing without any member explains that one must be added first", async () => {
  const app = await mountApp({ "GET /games": [catan], "GET /members": [] });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Emprunter", cardOf(app, "Catan"));
  await waitFor(() => app.$("#toasts").textContent.includes("Ajoutez d'abord"), "le message d'aide");
  assertTrue(!app.$("#borrow-dialog").open, "la boîte d'emprunt ne doit pas s'ouvrir");
});

test("returning a borrowed game finds its ongoing loan, calls the return route and updates the card", async () => {
  let games = [catan, dixit];
  const app = await mountApp({
    "GET /games": () => games,
    "GET /members": [camille],
    "GET /members/m1/loans": [
      // An old, returned loan of the same game, then the ongoing one (no returnedAt).
      { id: "l1", gameID: "g2", memberID: "m1", borrowedAt: "2026-10-01T10:00:00Z", dueAt: "2026-10-15T10:00:00Z", returnedAt: "2026-10-10T10:00:00Z" },
      { id: "l2", gameID: "g2", memberID: "m1", borrowedAt: "2026-11-10T10:00:00Z", dueAt: "2026-11-24T10:00:00Z" },
    ],
    "POST /loans/l2/return": () => {
      games = [catan, { ...dixit, isAvailable: true }];
      return { id: "l2", gameID: "g2", memberID: "m1", returnedAt: "2026-11-17T10:00:00Z" };
    },
  });
  await waitFor(() => app.$$("#games-list .card").length === 2);
  const labels = [...cardOf(app, "Dixit").querySelectorAll("button")].map((button) => button.textContent);
  assertTrue(labels.includes("Rendre") && !labels.includes("Emprunter"), "Dixit est emprunté : Rendre à la place d'Emprunter");
  app.click("Rendre", cardOf(app, "Dixit"));
  await waitFor(() => cardOf(app, "Dixit").textContent.includes("Disponible"), "Dixit redevient disponible");
  assertTrue(app.calls.some((call) => call.method === "POST" && call.path === "/loans/l2/return"), "l'emprunt en cours l2 est rendu");
  assertTrue(!app.calls.some((call) => call.path === "/loans/l1/return"), "l'ancien emprunt l1 ne doit pas être touché");
  assertIncludes(app.$("#toasts").textContent, "« Dixit » a été rendu.");
});

test("a failed return is shown in French", async () => {
  const app = await mountApp({
    "GET /games": [dixit],
    "GET /members": [camille],
    "GET /members/m1/loans": [{ id: "l2", gameID: "g2", memberID: "m1", borrowedAt: "2026-11-10T10:00:00Z", dueAt: "2026-11-24T10:00:00Z" }],
    "POST /loans/l2/return": [409, { error: true, reason: "Loan is already returned" }],
  });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Rendre", cardOf(app, "Dixit"));
  await waitFor(() => app.$("#toasts").textContent.includes("Cet emprunt a déjà été rendu."), "le message d'erreur en français");
});

// --- Emprunts en retard

// Une date prévue il y a 3 jours, à midi : le calcul en jours calendaires donne toujours 3.
function daysAgoAtNoon(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

test("overdue loans show the game, the member, the due date and the days late in words", async () => {
  const lateLoan = { id: "l1", gameID: "g1", memberID: "m1", borrowedAt: daysAgoAtNoon(17), dueAt: daysAgoAtNoon(3) };
  const app = await mountApp(
    { "GET /loans/overdue": [lateLoan], "GET /games": [catan], "GET /members": [camille] },
    { hash: "#overdue" },
  );
  await waitFor(() => app.$$("#overdue-list .row").length === 1, "une ligne en retard");
  const row = app.$("#overdue-list .row");
  assertIncludes(row.textContent, "Catan");
  assertIncludes(row.textContent, "Camille");
  assertIncludes(row.textContent, "retour prévu le");
  assertEqual(row.querySelector(".badge").textContent, "3 jours de retard");
  assertTrue(row.classList.contains("late"), "la ligne est aussi mise en évidence visuellement");
  assertTrue(app.$("#overdue-empty").hidden, "pas de message « aucun retard »");
});

test("the overdue counter is visible without opening the overdue view", async () => {
  const late = { gameID: "g1", memberID: "m1", borrowedAt: daysAgoAtNoon(20), dueAt: daysAgoAtNoon(6) };
  const app = await mountApp({
    "GET /games": [catan],
    "GET /loans/overdue": [{ ...late, id: "l1" }, { ...late, id: "l2" }],
  });
  await waitFor(() => !app.$("#overdue-count").hidden, "le compteur de retards");
  assertEqual(app.$("#overdue-count").textContent, "2");
  assertTrue(app.$("#overdue").hidden, "la vue des retards n'est pas ouverte");
});

test("with nothing overdue, a message says so and the counter is hidden", async () => {
  const app = await mountApp(
    { "GET /loans/overdue": [], "GET /games": [catan], "GET /members": [camille] },
    { hash: "#overdue" },
  );
  await waitFor(() => !app.$("#overdue-empty").hidden, "le message « aucun retard »");
  assertIncludes(app.$("#overdue-empty").textContent, "Aucun emprunt en retard");
  assertEqual(app.$$("#overdue-list .row").length, 0);
  assertTrue(app.$("#overdue-count").hidden, "le compteur est caché quand il n'y a aucun retard");
});

// --- Adhérent·es

test("members tab lists the members", async () => {
  const app = await mountApp({ "GET /members": [camille] }, { hash: "#members" });
  await waitFor(() => app.$$("#members-list .row").length === 1);
  assertIncludes(app.$("#members-list .row").textContent, "Camille");
  assertIncludes(app.$("#members-list .row").textContent, "camille@example.com");
});

test("with no member, a message invites to add one", async () => {
  const app = await mountApp({ "GET /members": [] }, { hash: "#members" });
  await waitFor(() => !app.$("#members-empty").hidden);
  assertIncludes(app.$("#members-empty").textContent, "Ajouter un·e adhérent·e");
});

test("adding a member posts the form", async () => {
  const app = await mountApp({ "GET /members": [], "POST /members": [201, camille] }, { hash: "#members" });
  await waitFor(() => !app.$("#members-empty").hidden);
  app.click("Ajouter un·e adhérent·e");
  const form = app.$("#member-form");
  form.elements.name.value = " Camille ";
  form.elements.email.value = "camille@example.com";
  form.requestSubmit();
  await waitFor(() => app.calls.some((call) => call.method === "POST" && call.path === "/members"), "l'appel POST /members");
  assertEqual(app.calls.find((call) => call.method === "POST").body, { name: "Camille", email: "camille@example.com" });
});

const rowOf = (app, name) => app.$$("#members-list .row").find((row) => row.querySelector("strong").textContent === name);

test("editing a member opens a prefilled form and sends a PUT", async () => {
  const app = await mountApp(
    { "GET /members": [camille], "PUT /members/m1": { ...camille, name: "Camille D." } },
    { hash: "#members" },
  );
  await waitFor(() => app.$$("#members-list .row").length === 1);
  app.click("Modifier", rowOf(app, "Camille"));
  await waitFor(() => app.$("#member-dialog").open, "la boîte de modification");
  const form = app.$("#member-form");
  assertEqual(app.$("#member-dialog-title").textContent, "Modifier « Camille »");
  assertEqual(form.elements.email.value, "camille@example.com");
  form.elements.name.value = "Camille D.";
  form.requestSubmit();
  await waitFor(() => app.calls.some((call) => call.method === "PUT"), "l'appel PUT /members/m1");
  const put = app.calls.find((call) => call.method === "PUT");
  assertEqual(put.path, "/members/m1");
  // Son propre e-mail est renvoyé tel quel : ce n'est pas un conflit.
  assertEqual(put.body, { name: "Camille D.", email: "camille@example.com" });
  await waitFor(() => !app.$("#member-dialog").open, "la boîte se ferme");
});

test("an email used by another member is shown in French and the edit form stays open", async () => {
  const app = await mountApp(
    {
      "GET /members": [camille],
      "PUT /members/m1": [409, { error: true, reason: "A member with this email already exists" }],
    },
    { hash: "#members" },
  );
  await waitFor(() => app.$$("#members-list .row").length === 1);
  app.click("Modifier", rowOf(app, "Camille"));
  app.$("#member-form").elements.email.value = "alex@example.com";
  app.$("#member-form").requestSubmit();
  await waitFor(() => !app.$("#member-dialog .form-error").hidden, "le message d'erreur");
  assertIncludes(app.$("#member-dialog .form-error").textContent, "utilise déjà cette adresse e-mail");
  assertTrue(app.$("#member-dialog").open, "le formulaire devrait rester ouvert");
});

test("deleting a member asks for confirmation, then removes them from the list", async () => {
  let members = [camille];
  const app = await mountApp(
    {
      "GET /members": () => members,
      "DELETE /members/m1": () => {
        members = [];
        return [204];
      },
    },
    { hash: "#members" },
  );
  await waitFor(() => app.$$("#members-list .row").length === 1);
  app.click("Supprimer", rowOf(app, "Camille"));
  await waitFor(() => app.$("#delete-member-dialog").open, "la confirmation");
  assertTrue(!app.calls.some((call) => call.method === "DELETE"), "rien ne doit partir avant la confirmation");
  app.click("Supprimer", app.$("#delete-member-dialog"));
  await waitFor(() => app.$$("#members-list .row").length === 0, "Camille disparaît de la liste");
  assertTrue(!app.$("#delete-member-dialog").open, "la confirmation se ferme");
});

test("a member with a loan history cannot be deleted: French message, confirmation stays open", async () => {
  const app = await mountApp(
    {
      "GET /members": [camille],
      "DELETE /members/m1": [409, { error: true, reason: "A member with loans cannot be deleted" }],
    },
    { hash: "#members" },
  );
  await waitFor(() => app.$$("#members-list .row").length === 1);
  app.click("Supprimer", rowOf(app, "Camille"));
  app.click("Supprimer", app.$("#delete-member-dialog"));
  await waitFor(() => !app.$("#delete-member-dialog .form-error").hidden, "le message d'erreur");
  assertIncludes(app.$("#delete-member-dialog .form-error").textContent, "historique d'emprunts");
  assertTrue(app.$("#delete-member-dialog").open, "la confirmation devrait rester ouverte");
});

test("a member's loans show the game title, the dates and the three states", async () => {
  const app = await mountApp(
    {
      "GET /members": [camille],
      "GET /games": [catan, dixit],
      "GET /members/m1/loans": [
        { id: "l1", gameID: "g1", memberID: "m1", borrowedAt: "2026-01-05T10:00:00Z", dueAt: "2026-01-19T10:00:00Z", returnedAt: "2026-01-12T10:00:00Z" },
        { id: "l2", gameID: "g2", memberID: "m1", borrowedAt: "2020-03-01T10:00:00Z", dueAt: "2020-03-15T10:00:00Z" },
        { id: "l3", gameID: "g1", memberID: "m1", borrowedAt: "2099-06-01T10:00:00Z", dueAt: "2099-06-15T10:00:00Z" },
      ],
    },
    { hash: "#members" },
  );
  await waitFor(() => app.$$("#members-list .row").length === 1);
  app.click("Emprunts", rowOf(app, "Camille"));
  await waitFor(() => app.$("#member-loans-dialog").open, "le panneau des emprunts");
  const rows = app.$$("#member-loans-list .row");
  assertEqual(rows.length, 3);
  assertEqual(app.$("#member-loans-title").textContent, "Emprunts de Camille");
  // Le titre du jeu, jamais son identifiant.
  assertIncludes(rows[0].textContent, "Catan");
  assertTrue(!rows[0].textContent.includes("g1"), "l'identifiant du jeu ne doit pas s'afficher");
  assertIncludes(rows[0].textContent, "Emprunté le 5 janvier 2026");
  assertIncludes(rows[0].textContent, "retour prévu le 19 janvier 2026");
  assertEqual(rows[0].querySelector(".badge").textContent, "Rendu");
  assertIncludes(rows[1].textContent, "Dixit");
  assertEqual(rows[1].querySelector(".badge").textContent, "En retard");
  assertTrue(rows[1].classList.contains("late"), "la ligne en retard est mise en évidence");
  assertEqual(rows[2].querySelector(".badge").textContent, "En cours");
  assertTrue(app.$("#member-loans-empty").hidden, "pas de message de liste vide");
});

test("a member without loans gets a clear message, not a blank panel", async () => {
  const app = await mountApp(
    { "GET /members": [camille], "GET /games": [catan], "GET /members/m1/loans": [] },
    { hash: "#members" },
  );
  await waitFor(() => app.$$("#members-list .row").length === 1);
  app.click("Emprunts", rowOf(app, "Camille"));
  await waitFor(() => app.$("#member-loans-dialog").open, "le panneau des emprunts");
  assertTrue(!app.$("#member-loans-empty").hidden, "le message de liste vide doit s'afficher");
  assertIncludes(app.$("#member-loans-empty").textContent, "Aucun emprunt");
  assertEqual(app.$$("#member-loans-list .row").length, 0);
});

test("an email already in use is shown in French", async () => {
  const app = await mountApp(
    { "GET /members": [], "POST /members": [409, { error: true, reason: "A member with this email already exists" }] },
    { hash: "#members" },
  );
  await waitFor(() => !app.$("#members-empty").hidden);
  app.click("Ajouter un·e adhérent·e");
  app.$("#member-form").requestSubmit();
  await waitFor(() => !app.$("#member-dialog .form-error").hidden, "le message d'erreur");
  assertIncludes(app.$("#member-dialog .form-error").textContent, "utilise déjà cette adresse e-mail");
});
