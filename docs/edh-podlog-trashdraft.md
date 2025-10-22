<!-- Slide number: 1 -->
Nom de l’appli : EDH PodLog

Objectifs de l’appli :
1. Playgroup
Avoir un répertoire de joueur et de deck
Utiliser ce répertoire pour organiser et traquer des parties
Identifier les statistiques de parties par deck et par joueurs
2. Deck evaluation
Sourcer les decks et cartes de Sryfall
Fournir des statistiques précise par deck en fonction de son contenu
Ajouter des informations manuelles sur les decks sur base de critères précis
3. Interconnection
Connecter My MTG toolbox à google
Pouvoir interconnecter les profils, associer un joueur à un compte « EDH PodLog»
Être sur un modèle PWA, accessible en ligne et super facile à utiliser sur mobile
4. Partie
Intégrer les fonctionnalités de suivi d’une partie de commander

<!-- Slide number: 2 -->
# MVP
Faire son profil de joueur
Enregistrer ses decks et avoir toutes les informations sur leur contenu (scryfall/moxfield/magicville…)
Noter ses decks, faire des catégories…
Voir des métriques de decks

<!-- Slide number: 3 -->
# Addition 1
Traquer des parties en enregistrant les joueurs et decks (ou pas)
Noter les informations essentielles de chaque partie
Afficher des statistiques par joueur et par deck en fonction des parties jouées
Importer en masse des données existantes ?
Extraire des données en CSV ?

<!-- Slide number: 4 -->
# Addition 2
Avoir une gestion de compte et une accessibilité online multi connection
Associer des joueurs enregistrés à des comptes existant
Envoyer des invitations?
Avoir un onglet de stats croisées (ex : partie de moi + untel avec tel deck en 2nde position)

<!-- Slide number: 5 -->
# Structure des macro infos
Joueurs
Possède des decks qui lui sont propre
Joue des parties
Est associé à des playgroups
Decks
Possède des caractéristiques de notation personnelles au joueur
Peut être sélectionné par son joueur propriétaire dans une partie
Parties
Peut intégrer des joueurs
Peut intégrer des decks de joueurs
Playgroups
Peut intégrer des joueurs

<!-- Slide number: 6 -->
# Structure de l’appli

Front page :
Accès au profil perso [Ecran]
Lancement d’une partie [Formulaire? Log? Compteur ?]
onglet statistique [Ecran]
Profil perso
Accès à chaque deck (création de deck) [Ecran]
Modification des infos du profil [Ecran]
Historique des parties [Ecran]
More to come