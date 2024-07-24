const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
}));

const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
    }
});

const rules = [
    {
        name: "biskit",
        condition: (data, params) => data.totalResult === params.targetNumber,
        action: (data) => {
            // Action à exécuter
            return new Promise((resolve) => {
                io.in(data.room).emit('biskit', `${data.player.name} a fait un biskit !`);
                setTimeout(() => resolve(), 5000); // Attendre 5 secondes avant de résoudre
            });
        },
        params: { targetNumber: 7 }
    },
    {
        name: "double",
        condition: (data, params) => data.diceResults[0] === data.diceResults[1],
        action: (data) => {
            // Action à exécuter
            return new Promise((resolve) => {
                io.in(data.room).emit('double', data.diceResults[0]);
                resolve();
            });
        },
        params: {}
    }
];

const applyRules = async (data) => {
    for (let rule of rules) {
        if (rule.condition(data, rule.params)) {
            await rule.action(data);
        }
    }

    // Passer au joueur suivant après vérification des règles
    rooms[data.room].currentTurn = (rooms[data.room].currentTurn + 1) % rooms[data.room].players.length;
    const nextPlayer = rooms[data.room].players[rooms[data.room].currentTurn];
    io.in(data.room).emit('updateTurn', {
        playerId: nextPlayer.id,
        playerName: nextPlayer.name
    });
};

let rooms = {}; // Pour gérer les salles de jeu

io.on('connection', (socket) => {
    //console.log('New client connected');

    socket.on('createRoom', ({ roomName, playerName }) => {
        //console.log('createRoom:', room); // Log lors de la création de la salle
        if (!rooms[roomName]) {
            rooms[roomName] = {
                players: [{ id: socket.id, name: playerName }],
                currentTurn: 0,
                history: []
            };
            //console.log('Room created:', rooms[room]);
            socket.join(roomName);
            socket.emit('roomCreated', roomName);
            io.in(roomName).emit('playerJoined', rooms[roomName].players);
        }
    });

    socket.on('joinRoom', ({ roomName, playerName }) => {
        //console.log('joinRoom:', room); // Log lors de la création de la salle
        if (rooms[roomName]) {
            //Ajouter joueur à la liste
            rooms[roomName].players.push({ id: socket.id, name: playerName });
            socket.join(roomName);
            //Mise à jour de la liste côté client
            io.in(roomName).emit('playerJoined', rooms[roomName].players);

            //Commencer partie si plus d'un joueur dans la salle
            if (rooms[roomName].players.length > 1) {
                io.in(roomName).emit('startGame', roomName);
                //Définition du tour du joueur côté client
                const currentPlayer = rooms[roomName].players[rooms[roomName].currentTurn];
                console.log('joinRoom before updateTurn: playerID: ' + currentPlayer.id + ', playerName: ' + currentPlayer.name);
                io.in(roomName).emit('updateTurn', {
                    playerId: currentPlayer.id,
                    playerName: currentPlayer.name
                });
                //Envoyer l'historique de la salle aux nouveaux joueurs
                socket.emit('updateHistory', rooms[roomName].history);
            }
        }
    });

    socket.on('rollDice', async ({ room, numDice }) => {
        if (rooms[room] && rooms[room].players[rooms[room].currentTurn].id === socket.id) {
            
            //Définition nombre de tirages suivants paramètre client
            const diceResults = Array.from({ length: numDice }, () => Math.floor(Math.random() * 6) + 1);
            const totalResult = diceResults.reduce((sum, value) => sum + value, 0);
            const currentPlayer = rooms[room].players[rooms[room].currentTurn];

            //Mettre à jour l'historique
            const rollRecord = {
                playerName: currentPlayer.name,
                diceResults,
                totalResult
            };
            rooms[room].history.push(rollRecord);

            //Envoi des résultats de chaque dé (Array) et du total additionné (Number)
            io.in(room).emit('diceResult', {diceResults,totalResult});
            //Update de l'historique
            io.in(room).emit('updateHistory', rooms[room].history); // Envoyer l'historique mis à jour

            const data = {
                diceResults,
                totalResult,
                players: rooms[room].players,
                currentPlayer,
                room
            };

            await applyRules(data);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        for (let room in rooms) {
            //Supprime le joueur de la liste de joueur de cette room
            rooms[room].players = rooms[room].players.filter(id => id !== socket.id);
            //Supprime la room si elle est vide
            if (rooms[room].players.length === 0) {
                delete rooms[room];
            } else {
                //Met à jour la liste des joueurs côté client
                io.in(room).emit('playerJoined', rooms[room].players);
                // Met à jour le tour si le joueur déconnecté était le prochain à jouer
                if (rooms[room].currentTurn >= rooms[room].players.length) {
                    rooms[room].currentTurn = 0;
                }
                //Passe le joueur en cours coté client
                const currentPlayer = rooms[room].players[rooms[room].currentTurn];
                io.in(room).emit('updateTurn', {
                    playerId: currentPlayer.id,
                    playerName: currentPlayer.name
                });
            }
        }
    });
});

const PORT = process.env.PORT || 5480;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
