/* trek.js */
(function() {

  registerEvent(window, 'load', main);

  const
    SYSTEM_DESTROYED = Infinity,
    SYSTEM_FUNCTIONAL = 0,
    GRID_WIDTH = 1000,
    GRID_HEIGHT = 1000,
    SCALE = GRID_WIDTH / 20,
    SHIP_SPACING = SCALE,
    MOVE_ABATE = 15,
    ROLE_SELF = 0,
    ROLE_OPPONENT = 1,
    SOCIETY_UFP = 'UFP',
    SOCIETY_KLINGON = 'Klingon Empire',
    NUM_STARS = 200,
    NUM_NEBULAE = 3,
    NOTICE_FLASH_COUNT = 10,
    NOTICE_FLASH_MS = 250;

  function main() {

    /** players **/
    function Player() { // rotate whole grid instead
      this.fleet = [];
      this.role = -1;
      this.shipFocus = null;
      this.shipTarget = null;
      this.ready = false;
      this.doneMoving = false;
      this.doneFiring = false;
    }
    Player.prototype.addShip = function(argShip) {
      var ship = typeof argShip === 'object' ? argShip : new Warship({society: this.society, type: argShip});
      if (ship.type) {
        this.fleet.push(ship);
        this.deploy(ship);
        ship.render();
      }
    };
    Player.prototype.addShips = function(types) {
      for (let ix in types) {
        var ship = new Warship({society: this.society, type: types[ix]});
        if (ship.type) {
          this.fleet.push(ship);
          this.deploy(ship);
          ship.render();
        }
      }
    };
    Player.prototype.deploy = function(ship) {
      ship.coords = { // stagger
        x: this.society.initX + SHIP_SPACING / 2 * (this.fleet.indexOf(ship) + this.fleet.indexOf(ship) % 2) * (1 - (this.fleet.indexOf(ship) % 2) * 2),
        y: this.initY - SHIP_SPACING  / 2 * (1 - (Math.floor((this.fleet.indexOf(ship) + 1) / 2) % 2) * 2) * (1 - (this.role % 2) * 2)
      };
      ship.orient = (Math.random() * 10 - 5) + 180 * this.role;
    };
    // End Player()

    function Self(specs = {}) {
      this.society = specs.society;
      this.initY = Math.round(GRID_HEIGHT * 7 / 8 + 1);
      this.role = ROLE_SELF;
      this.shipTarget = null;
    }
    Self.prototype = new Player;
    // END Self()

    function Opponent(specs = {}) {
      this.society = specs.society;
      this.initY = Math.round(GRID_HEIGHT / 8);
      this.role = ROLE_OPPONENT;
      this.shipTarget = null;
    }
    Opponent.prototype = new Player;
    // END Opponent()
    /** END players **/


    /** components **/
    function MCP() {
      this.turn = 0;
      this.rotation = 0;
      this.federation = new Federation;
      this.klingon = new Klingon;
      this.romulan = null;
      this.symbols = new Symbols;
      this.grid = new Grid({ div: document.getElementById('carte'), map: new Map(), rotation: this.rotation });
      this.pane = new Pane(document.getElementById('pane'));
      this.face = new Face(document.getElementById('face'));
      this.notice = new Notice(document.getElementById('notice'));
      this.instruments = new Instruments(document.getElementById('instruments'), this);
      this.hold = document.getElementById('hold') || {};
      this.audio = new (window.AudioContext || window.webkitAudioContext)();
      this.players = {}; // assigned by server
      this.self = null;
      this.opponent = null;
      this.phase = '';
      this.moveOrder = [];
      this.initiative = Math.round(Math.random());
      this.notes = { tones: [440], duration: 500 };
    }
    MCP.prototype.assignSelf = function(society) {
      this.self = new Self({society: society});
      this.players[0] = this.self; // REMOVE post-local
    };
    MCP.prototype.assignOpponent = function(society) {
      this.opponent = new Opponent({society: society});
      this.players[1] = this.opponent; // REMOVE post-local
    };
    MCP.prototype.setPlayerReady = function() {
      this.self.ready = true;
      this.swapPlayers();
      this.instruments.availableShipIndex = 0;
      this.instruments.availableShip = new Warship({society: this.self.society, type: this.self.society.getShips()[0]});
      this.instruments.availableShip.output();
      if (this.checkPlayersReady()) {
        this.doAccounting();
        playTones({ tones: [440, 330, 220, 440, 330, 220, 440, 330, 220, 440, 330, 220], duration: 750 });
        this.startPhaseMove();
      }
    };
    MCP.prototype.setPlayerDoneMoving = function() {
      this.self.doneMoving = true;
      this.symbols.removeAll('zones');
      for (let ix in this.self.fleet) {
        if (this.self.fleet[ix]) {
          this.self.fleet[ix].finishMove();
        }
      }
      if (this.checkPhaseMoveOver()) {
        this.endPhaseMove();
      }
      this.swapPlayers(!this.self.society * 1); // REMOVE post-local
    };
    MCP.prototype.setPlayerDoneFiring = function() {
      this.self.doneFiring = true;
      this.symbols.removeAll('arcs');
      for (let ix in this.self.fleet) {
        this.symbols.remove('rings', this.self.fleet[ix].ring);
      }
      if (this.checkPhaseFireOver()) {
        this.endPhaseFire();
      }
      this.swapPlayers(!this.self.society * 1); // REMOVE post-local
    };
    MCP.prototype.getAllShips = function() {
      return this.players[0].fleet.concat(this.players[1].fleet);
    };
    MCP.prototype.getAllRemainingShips = function() {
      // check destroyed
      return this.players[0].fleet.concat(this.players[1].fleet);
    };
    MCP.prototype.notifyPhase = function(phase) {
      switch (phase) {
        case 'move':
          this.notice.setText('movement phase');
          this.notice.flash('move');
          this.instruments.hide('ready');
          this.instruments.hide('fire');
          this.instruments.hide('prev');
          this.instruments.hide('add');
          this.instruments.hide('next');
          this.instruments.show('move');
          break;
        case 'fire':
          this.notice.setText('firing phase');
          this.notice.flash('fire');
          this.instruments.hide('move');
          this.instruments.show('fire');
          break;
        case 'deploy':
          this.notice.setText('fleet deployment phase');
          this.notice.flash('deploy');
          this.instruments.show('prev');
          this.instruments.show('add');
          this.instruments.show('next');
          this.instruments.show('ready');
          this.instruments.availableShip = new Warship({society: this.self.society, type: this.self.society.getShips()[0]});
          this.instruments.availableShip.output();
          this.pane.elem.appendChild(this.instruments.availableShip.panel.elem);
          break;
      }
      return this.phase = phase;
    };
    MCP.prototype.checkPlayersReady = function() {
      return this.players[0].ready && this.players[1].ready;
    }
    MCP.prototype.arrangeMoveOrder = function() {
      var aFleetLen = [this.players[0].fleet.length, this.players[1].fleet.length];
      var either;
      this.moveOrder = [];
      if (aFleetLen[0] === aFleetLen[1]) {
        either = this.initiative;
      } else {
        either = (aFleetLen[0] < aFleetLen[1]) * 1;
      }
      this.initiative = !either * 1;
      while (aFleetLen[0] > 0 || aFleetLen[1] > 0) {
        if (aFleetLen[either]) {
          this.moveOrder.push(either);
          --aFleetLen[either];
        }
        either = !either * 1;
      }
    };
    MCP.prototype.startPhaseMove = function() {
      console.log('Movement Phase');
      this.phase = this.notifyPhase('move');
      ++this.turn;
      if (this.players[0] && this.players[0].fleet.length && this.players[1] && this.players[1].fleet.length) {
        var aShips = this.getAllRemainingShips();
        for (let ix in aShips) {
          if (aShips[ix].elem) {
            aShips[ix].aura = master.symbols.add('auras', new Aura(aShips[ix]));
          }
        }
        //playTones({ tones: [440, 330, 220, 440, 330, 220, 440, 330, 220], duration: 750 });
        this.arrangeMoveOrder();
        this.swapPlayers(this.moveOrder.shift());
      } else {
        console.error('At least one player has yet to deploy any ships.');
      }
    };
    MCP.prototype.checkPhaseMoveOver = function() {
      var yetToMove = 0;
      for (let player = 0; player < 2; ++player) {
        if (this.players[player].doneMoving) {
          continue;
        }
        var ix = 0, ship;
        while (ship = master.players[player].fleet[ix++]) {
          if (!ship.moved) {
            yetToMove++;
          }
        }
      }
      return !yetToMove;
    };
    MCP.prototype.endPhaseMove = function() {
      master.symbols.removeAll('auras');
      var aShips = this.getAllRemainingShips();
      for (let ix in aShips) {
        aShips[ix].moved = false;
      }
      this.players[0].doneMoving = this.players[1].doneMoving = false;
      this.startPhaseFire();
    };
    MCP.prototype.startPhaseFire = function() {
      console.log('Firing Phase');
      this.notifyPhase('fire');
      playTones({ tones: [200, 300, 400, 500, 600, 700, 800, 900, 1000, 0, 0, 0, 0, 0, 0, 200, 300, 400, 500, 600, 700, 800, 900, 1000,], duration: 1250 });
      for (let ix in this.self.fleet) {
        this.self.fleet[ix].ring = this.symbols.add('rings', new Ring(this.self.fleet[ix]));
      }
      for (let ix in this.opponent.fleet) {
        this.opponent.fleet[ix].ring = this.symbols.add('rings', new Ring(this.opponent.fleet[ix]));
      }
    };
    MCP.prototype.checkPhaseFireOver = function() {
      var bTargetsRemain = false;
      for (let player = 0; player < 2; ++player) {
        if (!this.players[player].doneFiring) {
          var a = 0, shipA;
          while (shipA = this.players[player].fleet[a++]) {
            var b = 0, shipB;
            while (shipB = this.players[!player * 1].fleet[b++]) {
              if (
                shipA.primary.fireReady() && shipA.primary.isInArc(shipB) ||
                shipA.secondary.fireReady() && shipA.secondary.isInArc(shipB)
              ) {
                bTargetsRemain = true;
                break;
              }
            }
          }
        }
      }
      return !bTargetsRemain;
    };
    MCP.prototype.endPhaseFire = function() {
      this.players[0].doneFiring = this.players[1].doneFiring = false;
      this.symbols.removeAll('rings');
      this.symbols.removeAll('halos');
      this.doAccounting();
      this.startPhaseMove();
    };
    MCP.prototype.doAccounting = function() {
      var aShips = this.getAllRemainingShips();
      for (let ix in aShips) {
        if (aShips[ix].elem) {
          aShips[ix].turnOfEvents();
        }
      }
    };
    MCP.prototype.swapPlayers = function(player) {
      if (typeof player === 'number') {
        //[this.players[0], this.players[1]] = [this.players[player], this.players[!player * 1]]; // post-local
        [this.self, this.opponent] = [this.players[player], this.players[!player * 1]]; // for testing only
        master.rotation = 180 * player;
      } else {
        //[this.players[0], this.players[1]] = [this.players[1], this.players[0]]; // post-local
        [this.self, this.opponent] = [this.opponent, this.self]; // for testing only
        master.rotation = this.grid.elem.getAttribute('transform').match('180') ? 0 : 180;
      }
      this.grid.elem.setAttribute('transform', 'rotate(' + master.rotation + ')');
    };
    MCP.prototype.outputPreviousShip = function() {
      if (this.instruments.availableShipIndex > 0) {
        this.instruments.availableShip = new Warship({society: this.self.society, type: this.self.society.getShips()[--this.instruments.availableShipIndex]});
        this.instruments.availableShip.output();
      }
    };
    MCP.prototype.outputNextShip = function() {
      if (this.instruments.availableShipIndex < this.self.society.getShips().length - 1) {
        this.instruments.availableShip = new Warship({society: this.self.society, type: this.self.society.getShips()[++this.instruments.availableShipIndex]});
        this.instruments.availableShip.output();
      }
    };
    MCP.prototype.addShipToFleet = function() {
      master.self.addShip(this.instruments.availableShip);
      this.instruments.availableShip = new Warship({society: this.self.society, type: this.self.society.getShips()[this.instruments.availableShipIndex]});
      this.instruments.availableShip.output();
      playTones({ tones: [440, 880], duration: 100 });
    };
    // END MCP()

    function Grid(specs = {}) {
      this.elem;
      this.div = specs.div; // parent
      this.map = specs.map; // defines custom bodies
      this.width = specs.map.width || GRID_WIDTH;
      this.height = specs.map.height || GRID_HEIGHT;
      this.create(specs);
      this.render();
    }
    Grid.prototype.render = function() {
      this.elem.appendChild(this.map.elem);
      this.elem.divider = this.elem.insertAdjacentElement('beforeend', createElementNS('g'));
      this.elem.insertAdjacentHTML('beforeend', '<defs><radialGradient id="dish"><stop offset="0%" class="fedDishMid"/><stop offset="100%" class="fedDishEdge"/></radialGradient></defs>', 'image/svg+xml');
      this.div.appendChild(this.elem);
    };
    Grid.prototype.create = function(specs) {
      this.elem = createElementNS();
      this.elem.setAttribute('id', 'grid');
      this.elem.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      this.elem.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      this.elem.setAttribute('viewBox', '0 0 1000 1000'); // svg 100 x 100
      this.elem.setAttribute('version', '1.1');
      this.elem.setAttribute('transform', 'rotate(' + specs.rotation + ')');
    };
    // END Grid()

    function Pane(elem) {
      this.elem = elem || document.getElementById('pane');
    }
    // END Pane()

    function Face(elem) {
      this.elem = elem || document.getElementById('face');
    }
    // END Face()

    function Notice(elem) {
      this.elem = elem || document.getElementById('notice');
      this.elem.innerHTML = '';
      this.count = 0;
      this.className = '';
      this.interval = 0;
    }
    Notice.prototype.setText = function(text) {
      this.elem.innerHTML = '&mdash; ' + text + ' &mdash;';
    };
    Notice.prototype.flash = function(className) {
      if (!this.count) {
        this.className = className;
        this.elem.setAttribute('class', this.className);
        this.interval = setInterval(() => master.notice.flash(), NOTICE_FLASH_MS);
      } else if (this.count > NOTICE_FLASH_COUNT) {
        this.count = 0;
        clearInterval(this.interval);
        return;
      } else {
        var className = this.count % 2 ? '' : this.className;
        this.elem.setAttribute('class', className);
      }
      ++this.count;
    };
    // END Notice()

    function Instruments(elem, master) {
      this.elem = elem || document.getElementById('instruments');
      this.availableShipIndex = 0;
      this.tools = [
        { id: 'move', text: 'done moving', method: master.setPlayerDoneMoving },
        { id: 'fire', text: 'done firing', method: master.setPlayerDoneFiring },
        { id: 'prev', text: '\u21D0', method: master.outputPreviousShip },
        { id: 'add', text: 'add to fleet', method: master.addShipToFleet },
        { id: 'next', text: '\u21D2', method: master.outputNextShip },
        { id: 'ready', text: 'engage', method: master.setPlayerReady }
      ];
      for (let ix in this.tools) {
        this[this.tools[ix].id] = document.createElement('button');
        this[this.tools[ix].id].appendChild(document.createTextNode(this.tools[ix].text));
        this[this.tools[ix].id].setAttribute('class', this.tools[ix].id);
        registerEvent(this[this.tools[ix].id], 'click', this.tools[ix].method.bind(master)); // check post-local
        this.elem.appendChild(this[this.tools[ix].id]);
      }
    }
    Instruments.prototype.show = function(button) {
      (this[button] || { style: null }).style.display = 'inline-block';
    };
    Instruments.prototype.hide = function(button) {
      (this[button] || { style: null }).style.display = 'none';
    };
    // END Instruments()

    function Panel() {
      this.elem = document.createElement('div');
      this.elem.setAttribute('class', 'panel');
      this.elem.containers = {};
      this.command = {};
      this.control = {};
      this.deflectors = {};
      this.engineering = {};
      this.helm = {};
      this.hull = {};
      this.impulse = {};
      this.navigation = {};
      this.primary = {};
      this.science = {};
      this.secondary = {};
      this.sensors = {};
      this.shields = {};
      this.tactical = {};
      this.warp = {};
    }
    // END Panel()

    function Facia() {
      this.elem = document.createElement('div');
      this.elem.setAttribute('class', 'facia');
    }
    // END Facia()

    function Map(specs = {}) { // overlay
      this.elem;
      this.width = specs.width || GRID_WIDTH;
      this.height = specs.height || GRID_HEIGHT;
      this.create();
    }
    Map.prototype.create = function() { // default star field
      this.elem = createElementNS();
      this.elem.setAttribute('id', 'map');
      this.elem.setAttribute('viewBox', '0 0 1000 1000');
      this.elem.setAttribute('fill', 'black');
      this.bg = '<rect id="bg" x="0" y="0" width="' + this.width + '" height="' + this.width + '" fill="black"/>';
      this.elem.insertAdjacentHTML('beforeend', this.bg, 'image/svg+xml');
      //this.gridPattern = '<defs><pattern id="gridPattern" x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="50" stroke-width="2" class="grid"/><line x1="0" y1="0" x2="50" y2="0" stroke-width="2" class="grid"/></pattern></defs><rect x="0" y="0" width="' + GRID_WIDTH + '" height="' + GRID_HEIGHT + '" fill="url(#gridPattern)"/>';
      //this.elem.insertAdjacentHTML('beforeend', this.gridPattern, 'image/svg+xml');
      this.hexPattern = new HexPattern;
      this.elem.appendChild(this.hexPattern.elem);
      var cx, cy, rx, ry;
      for (let count = 0; count < NUM_NEBULAE; ++count) {
        cx = Math.random() * this.width;
        cy = Math.random() * this.height;
        rx = Math.random() * this.width / 2 + this.width / 10;
        ry = Math.random() * this.height / 2 + this.height / 10;
        this.elem.insertAdjacentHTML('beforeend', '<defs><radialGradient id="nebGrad"><stop offset="0" class="nebStop0"/><stop offset="1" class="nebStop1"/></radialGradient></defs>', 'image/svg+xml');
        var eNeb = createElementNS('ellipse');
        eNeb.setAttribute('cx', cx);
        eNeb.setAttribute('cy', cy);
        eNeb.setAttribute('rx', rx);
        eNeb.setAttribute('ry', ry);
        eNeb.setAttribute('class', 'neb');
        eNeb.setAttribute('transform', 'rotate(' + Math.random() * 180 + ' ' + this.height / 2 + ' ' + this.height / 2 + ')');
        eNeb.setAttribute('fill', 'url(#nebGrad)');
        this.elem.appendChild(eNeb);
      };
      for (let count = 0; count < NUM_STARS; ++count) {
        if (count < NUM_STARS / 2) {
          cx = Math.floor(Math.random() * this.width) + .5;
          cy = Math.floor(Math.random() * this.height) + .5;
        } else {
          cx += Math.floor(Math.random() * this.width / 5 - this.width / 10) + .5;
          cy += Math.floor(Math.random() * this.height / 5 - this.height / 10) + .5;
        }
        cx = Math.abs(cx) % this.width;
        cy = Math.abs(cy) % this.height;
        var eStar = createElementNS('circle');
        eStar.setAttribute('cx', cx);
        eStar.setAttribute('cy', cy);
        eStar.setAttribute('r', !(count % 8) ? 2 : 1);
        var temperature = Math.floor(Math.random() * 384 - 192);
        eStar.setAttribute('fill', 'rgb(' + (255 - temperature)  + ',' + (255 - temperature) + ',' + (255 + temperature) + ')');
        this.elem.appendChild(eStar);
      }
    };
    // END Map()

    var HexPattern = function([X, Y] = [12, 41], r = 28.8) {
      this.elem = createElementNS('g');
      this.elem.setAttribute('viewBox', '0 0 100 100');
      for (let y = 0; y < Y; ++y) {
        var h = !(y % 2) ? 0 : r * 1.5;
        for (let x = 0; x < X; ++x) {
          this.elem.appendChild(this.createHex(this.getCoords(
            [r + h + x * r * 3, r + y * r * Math.sqrt(3) / 2], r
          )));
        }
      }
    };
    HexPattern.prototype.getCoords = function([x, y], r) {
      x -= SCALE / 2; // adjust for map
      y -= SCALE / 2;
      var h = r * Math.sqrt(3) / 2;
      return [
        [x - r / 2, y + h],
        [x + r / 2, y + h],
        [x + r, y],
        [x + r / 2, y - h],
        [x - r / 2, y - h],
        [x - r, y],
        [x - r / 2, y + h]
      ];
    };
    HexPattern.prototype.createHex = function(coords) {
      this.hex = createElementNS('polyline');
      this.hex.setAttribute('id', 'hex');
      this.hex.setAttribute('points', coords);
      this.hex.setAttribute('stoke-width', 1);
      return this.hex;
    };
    // END HexPattern()

    function Figure(specs = {}) {
      this.elem;
      this.object = specs.object || {};
      this.ship = specs.ship;
      this.idPrefix = specs.idPrefix || 'fig_';
    }
    Figure.prototype.render = function() { // overwrite if figure attaches to grid
      return this.ship.group.insertBefore(this.create(), this.ship.group.children[0]);
    };
    Figure.prototype.create = function() { // defined in subclasses
    };
    // END Figure()

    function Arc(specs = {}) {
      Figure.call(this, { object: specs.weapon });
      this.idPrefix = 'arc_';
      this.weapon = specs.weapon;
      this.from = specs.from;
      this.to = specs.to;
      this.render();
    }
    Arc.prototype = new Figure;
    Arc.prototype.render = function() {
      return master.grid.elem.insertBefore(this.create(), master.grid.elem.divider);
    };
    Arc.prototype.create = function() {
      var x = this.weapon.ship.coords['x'],
          y = this.weapon.ship.coords['y'],
          distFrom = this.from * SCALE,
          distTo = this.to * SCALE,
          startAng = (this.weapon.ship.orient - this.weapon.arc / 2 - 90) % 360,
          endAng = (this.weapon.ship.orient + this.weapon.arc / 2 - 90) % 360,
          x1from = x + distFrom * Math.cos(Math.PI * startAng / 180),
          y1from = y + distFrom * Math.sin(Math.PI * startAng / 180),
          x2from = x + distFrom * Math.cos(Math.PI * endAng / 180),
          y2from = y + distFrom * Math.sin(Math.PI * endAng / 180),
          x1to = x + distTo * Math.cos(Math.PI * startAng / 180),
          y1to = y + distTo * Math.sin(Math.PI * startAng / 180),
          x2to = x + distTo * Math.cos(Math.PI * endAng / 180),
          y2to = y + distTo * Math.sin(Math.PI * endAng / 180);
      if (!this.weapon.rangeMin) {
        x1from = x2from = x;
        y1from = y2from = y;
      }
      var draw = drawArc(x1from, y1from, x1to, y1to, x2from, y2from, x2to, y2to, distFrom, distTo);
      this.elem = createElementNS('path');
      this.elem.setAttribute('id', 'arc_' + stampDate());
      this.elem.setAttribute('d', draw);
      this.elem.setAttribute('fill', this.weapon.color);
      this.elem.setAttribute('opacity', .1);
      return this.elem;
    };
    // END Arc()

    function Halo(ship) {
      Figure.call(this, { ship: ship });
      this.idPrefix = 'halo_';
      ship.halo = this.render();
    }
    Halo.prototype = new Figure;
    Halo.prototype.create = function() {
      var circle = createElementNS('circle');
      circle.setAttribute('id', this.idPrefix + stampDate());
      circle.setAttribute('cx', SCALE);
      circle.setAttribute('cy', SCALE);
      circle.setAttribute('r', .9 * SCALE);
      circle.setAttribute('stroke-width', 5);
      circle.setAttribute('stroke-dasharray', '3');
      circle.setAttribute('stroke', master.phase === 'move' ? 'rgba(255, 192, 0, .67)' : 'rgba(255, 0, 102, .67)');
      circle.setAttribute('fill', master.phase == 'move' ? 'rgba(255, 192, 0, .15)' : 'rgba(255, 0, 102, .15)');
      this.elem = createElementNS('g');
      for (let deg = 0; deg < 360; deg += 45) {
        var adjust = (deg + 45) % 90 ? .225 : 0,
            x1 = SCALE + (.5 + adjust) * SCALE * Math.cos(Math.PI * deg / 180),
            y1 = SCALE + (.5 + adjust) * SCALE * Math.sin(Math.PI * deg / 180),
            x2 = SCALE + .85 * SCALE * Math.cos(Math.PI * deg / 180),
            y2 = SCALE + .85 * SCALE * Math.sin(Math.PI * deg / 180),
            line = createElementNS('line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke-width', 3);
        line.setAttribute('stroke', master.phase === 'move' ? 'rgba(255, 160, 0, 0)' : 'rgba(255, 0, 102, .67)');
        this.elem.appendChild(line);
      }
      this.elem.appendChild(circle);
      return this.elem;
    };
    // END Halo()

    function Aura(ship) {
      Figure.call(this, { ship: ship });
      this.idPrefix = 'aura_';
      ship.aura = this.render();
    }
    Aura.prototype = new Figure;
    Aura.prototype.create = function() {
      this.elem = createElementNS('circle');
      this.elem.setAttribute('id', this.idPrefix + stampDate());
      this.elem.setAttribute('cx', SCALE);
      this.elem.setAttribute('cy', SCALE);
      this.elem.setAttribute('r', SCALE / 1.5);
      this.elem.setAttribute('stroke-width', 0);
      this.elem.setAttribute('fill', master.self.society === this.ship.society ? 'rgba(0, 128, 255, .33)' : 'rgba(255, 0, 102, .25)');
      return this.elem;
    };
    // END Aura()

    function Ring(ship) {
      Figure.call(this, { ship: ship });
      this.idPrefix = 'ring_';
      ship.ring = this.render();
    }
    Ring.prototype = new Figure;
    Ring.prototype.create = function() {
      this.elem = createElementNS('circle');
      this.elem.setAttribute('id', this.idPrefix + stampDate());
      this.elem.setAttribute('cx', SCALE);
      this.elem.setAttribute('cy', SCALE);
      this.elem.setAttribute('r', SCALE / 1.5);
      this.elem.setAttribute('fill', 'none');
      this.elem.setAttribute('stroke-width', 3);
      this.elem.setAttribute('stroke', master.self.society === this.ship.society ? 'rgba(0, 128, 255, .5)' : 'rgba(255, 0, 102, .5)');
      return this.elem;
    };
    // END Ring()

    function Zone(ship) {
      Figure.call(this, { ship: ship });
      this.idPrefix = 'zone_';
      this.render();
    }
    Zone.prototype = new Figure;
    Zone.prototype.render = function() {
      return master.grid.elem.insertBefore(this.create(), master.grid.elem.divider);
    };
    Zone.prototype.create = function() {
      var x = this.ship.coords['x'],
          y = this.ship.coords['y'],
          dist = this.ship.getSpeed() * SCALE,
          startAng = (this.ship.orient - this.ship.getVeer() / 2 - 90) % 360,
          endAng = (this.ship.orient + this.ship.getVeer() / 2 - 90) % 360,
          x1 = x + dist * Math.cos(Math.PI * startAng / 180),
          y1 = y + dist * Math.sin(Math.PI * startAng / 180),
          x2 = x + dist * Math.cos(Math.PI * endAng / 180),
          y2 = y + dist * Math.sin(Math.PI * endAng / 180),
          draw = drawArc(x, y, x1, y1, x, y, x2, y2, 0, dist);
      this.elem = createElementNS('path');
      this.elem.setAttribute('id', this.idPrefix + stampDate());
      this.elem.setAttribute('class', 'zone');
      this.elem.setAttribute('d', draw);
      this.elem.setAttribute('fill', 'rgba(0, 96, 255, .1)');
      this.elem.setAttribute('stroke', '#0066cc');
      this.elem.setAttribute('stroke-width', 5);
      this.elem.setAttribute('stroke-dasharray', '15, 10');
      registerEvent(this.elem, 'click', this.ship.move.bind(this.ship));
      return this.elem;
    };
    // END Zone()

    function Symbols() {
      this.ships = [];
      this.stars = [];
      this.halos = [];
      this.rings = [];
      this.auras = [];
      this.arcs = [];
      this.zones = [];
    }
    Symbols.prototype.add = function(set, obj) {
      this[set].push(obj);
      return obj;
    };
    Symbols.prototype.replace = function(set, obj) {
      this.removeAll(set);
      this[set].push(obj);
      return obj;
    };
    Symbols.prototype.remove = function(set, obj) {
      var ix = this[set] ? this[set].indexOf(obj) : -1;
      if (ix > -1) {
        this[set][ix].object.active = false;
        if (this[set][ix].ship) {
          this[set][ix].ship.focused = false;
        } else if (this[set][ix].object.ship) {
          this[set][ix].object.ship.focused = false;
        }
        this[set].splice(ix, 1);
        obj.elem.parentNode.removeChild(obj.elem);
        delete obj.elem;
        delete obj;
      }
    };
    Symbols.prototype.removeAll = function(set) {
      var safety = 0;
      while (this[set].length && ++safety < 100) {
        this.remove(set, this[set][0]);
      }
      this[set].length = 0;
    };
    // END Symbols()

    function Readout() {
      this.elem = document.createElement('button');
      this.elem.setAttribute('class', 'readout');
      this.fractions = this.elem.fractions = []
    }
    Readout.prototype.update = function() {
    };
    // END Readout()

    function Brief() {
      this.elem = document.createElement('div');
      this.elem.setAttribute('class', 'brief');
    }
    // END Brief()
    /** end components **/


    /** societies **/
    function Society() { // super
      this.initX = Math.round(GRID_WIDTH / 2);
    }
    Society.prototype.getShips = function() {
      return Object.keys(oShipHulls[this.name]).reverse();
    };
    // END Socieity()

    function Federation() {
      this.name = SOCIETY_UFP;
      this.prefix = 'USS';
      this.primary = Phaser;
      this.secondary = Photon;
    }
    Federation.prototype = new Society;
    // END Federation()

    function Klingon() {
      this.name = SOCIETY_KLINGON;
      this.prefix = 'IKV';
      this.primary = Disruptor;
      this.secondary = Pulse;
    }
    Klingon.prototype = new Society;
    // END Klingon()
    /** END societies **/


    /** ships **/
    function Ship(specs = {}) { // super
      Object.assign(specs, { ship: this });
      this.xml = specs.xml;
      this.decks = [[], [], [], [], [], []];
      this.coords = {x: null, y: null};
      this.orient = 0;
      this.elem = {};
      this.halo = {};
      this.zone = {};
      this.aura = {};
      this.ring = {};
      this.focused = false;
      this.targeted = false;
      this.moved = false;
      this.ready = false;
      this.idPrefix = null;
      this.society = specs.society || null;
      this.panel = new Panel;
      this.terse = new Facia;
      this.shields = new Shields(specs);
      this.hull = new Hull(specs);
      this.impulse = new Impulse(specs);
      this.warp = new Warp(specs);
      this.deflectors = new Deflectors(specs);
      this.control = new DamageControl(specs);
      this.sensors = new Sensors(specs);
      this.engineering = new Engineering(specs);
      this.navigation = new Navigation(specs);
      this.science = new Science(specs);
      this.tactical = new Tactical(specs);
      this.helm = new Helm(specs);
      this.command = new Command(specs);
    }
    Ship.prototype.isReady = function() {
      var bReady = true;
      for (let member in this) {
        bReady *= (this[member] !== null && typeof this[member] !== 'undefined');
      }
      return this.ready = !!bReady;
    };
    Ship.prototype.focus = function() { // must be bound else refers to elem
      if (master.phase === 'move') {
        if (master.self.society !== this.society) { // opponent clicked
          this.isTargeted();
        } else { // self clicked
          this.output();
          master.symbols.remove('halos', this.halo);
          this.panel.primary.classList.remove('highlight');
          this.panel.secondary.classList.remove('highlight');
          if (!this.moved) {
            if (this.zone.elem) { // about-face
              this.orient = (this.orient + 180) % 360;
              this.group.setAttribute('transform', 'rotate(' + this.orient + ' ' + SCALE + ' ' + SCALE + ')');
              this.finishMove();
            } else { // prepare for move
              this.zone = master.symbols.replace('zones', new Zone(this));
              this.hasFocus();
            }
          } else {
            master.symbols.removeAll('zones');
          }
        }
      } else if (master.phase === 'fire') {
        master.symbols.removeAll('halos');
        if (master.self.society !== this.society) { // opponent clicked
          this.isTargeted();
          master.self.shipFocus.finishFire();
        } else { // self clicked
          this.output();
          this.hasFocus();
          this.panel.primary.classList.remove('highlight');
          this.panel.secondary.classList.remove('highlight');
          if (this.primary.actual && !this.primary.active && this.primary.fireReady()) {
            master.symbols.removeAll('arcs'); // makes wpn.active = false
            this.primary.showArc();
            this.primary.active = true;
            this.panel.primary.classList.add('highlight');
          } else if (this.secondary.actual && !this.secondary.active && this.secondary.fireReady()) {
            master.symbols.removeAll('arcs'); // makes wpn.active = false
            this.secondary.showArc();
            this.secondary.active = true;
            this.panel.secondary.classList.add('highlight');
          }
        }
      }
    };
    Ship.prototype.hasFocus = function() {
      this.output();
      for (let ix in master.self.fleet) {
        master.self.fleet[ix].focused = this === master.self.fleet[ix];
      }
      master.self.shipFocus = this;
    };
    Ship.prototype.isTargeted = function() {
      this.outputTerse();
      this.halo = master.symbols.replace('halos', new Halo(this));
      for (let ix in master.opponent.fleet) {
        master.opponent.fleet[ix].targeted = this === master.opponent.fleet[ix];
      }
      if (master.self.shipFocus && this === master.self.shipTarget) {
        if (master.self.shipFocus.primary.active) {
          console.log('Fire ' + master.self.shipFocus.primary.name + '!');
          master.self.shipFocus.primary.fire(this);
        } else if (master.self.shipFocus.secondary.active) {
          console.log('Fire ' + master.self.shipFocus.secondary.name + '!');
          master.self.shipFocus.secondary.fire(this);
        }
      }
      master.self.shipTarget = this;
      if (master.checkPhaseFireOver()) {
        master.endPhaseFire();
      }
    };
    Ship.prototype.finishMove = function() {
      this.moved = true;
      master.symbols.remove('auras', this.aura);
      master.symbols.remove('zones', this.zone);
      master.swapPlayers(master.moveOrder.shift());
      if (master.checkPhaseMoveOver()) {
        master.endPhaseMove();
      }
    };
    Ship.prototype.finishFire = function() {
      if (!this.primary.fireReady() && !this.secondary.fireReady()) {
        master.symbols.remove('rings', this.ring);
      }
    };
    Ship.prototype.render = function() {
      this.elem; // icon
      this.group; // wrapper
      this.createIcon();
      this.createWrapper();
      this.elem.appendChild(this.group);
      master.grid.elem.appendChild(this.elem);
      master.symbols.add('ships', this.elem);
      registerEvent(this.elem, 'click', this.focus.bind(this));
    };
    Ship.prototype.createIcon = function() {
      this.elem = createElementNS();
      this.elem.setAttribute('id', this.idPrefix + stampDate());
      this.elem.setAttribute('x', this.coords['x'] - SCALE);
      this.elem.setAttribute('y', this.coords['y'] - SCALE);
      this.elem.setAttribute('viewBox', '0 0 100 100'); // svg 100 x 100
      this.elem.setAttribute('width', SCALE * 2);
      this.elem.setAttribute('height', SCALE * 2);
    };
    Ship.prototype.createWrapper = function() {
      this.group = createElementNS('g');
      this.group.setAttribute('transform', 'rotate(' + this.orient + ' ' + SCALE + ' ' + SCALE + ')');
      this.group.setAttribute('class', 'ship');
      this.group.insertAdjacentHTML('beforeend', this.xml, 'image/svg+xml');
    };
    Ship.prototype.move = function(event) {
      master.symbols.remove('zones', this.zone);
      var x, y, x1, y1, x2, y2;
      [x1, y1] = [this.coords['x'], this.coords['y']];
      [x2, y2] = getEventCoords(event);
      var prog = MOVE_ABATE / 5,
          angle = Math.atan2((y1 - y2), (x1 - x2)) * 180 / Math.PI,
          dist = Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
      master.symbols.remove('auras', this.aura);
      this.orient = (angle + 270) % 360;
      this.group.setAttribute('transform', 'rotate(' + this.orient + ' ' + SCALE + ' ' + SCALE + ')');
      movePortion(this, prog);
      function movePortion(ship, prog) {
        prog += (dist / 2 - Math.abs(dist / 2 - prog)) / MOVE_ABATE + .5;
        x = x1 - prog * Math.cos(Math.PI * angle / 180);
        y = y1 - prog * Math.sin(Math.PI * angle / 180);
        ship.elem.setAttribute('x', x - SCALE);
        ship.elem.setAttribute('y', y - SCALE);
        if (prog < dist) {
          return setTimeout(() => movePortion(ship, prog), 10);
        } else {
          ship.elem.setAttribute('x', x2 - SCALE);
          ship.elem.setAttribute('y', y2 - SCALE);
          ship.coords = {x: x2, y: y2};
          ship.finishMove();
          return;
        }
      }
    };
    Ship.prototype.getPointValueAdjusted = function() {
    };
    Ship.prototype.calculateDistance = function(target) {
      return Math.sqrt(Math.pow(this.coords['x'] - target.coords['x'], 2) + Math.pow(this.coords['y'] - target.coords['y'], 2)) / SCALE;
    };
    Ship.prototype.tabulateDeckTotals = function() {
      for (let ix in this.decks) {
        var nMomentaryTotal = 0;
        for (let sys in this.decks[ix]) {
          if (this.decks[ix][sys].name) { // ignore non-sys props, like total
            nMomentaryTotal += this.decks[ix][sys].momentary;
          }
        }
        this.decks[ix].total = nMomentaryTotal;
      }
    };
    Ship.prototype.takeFire = function(weapon) {
      weapon.render(this);
      var nPenetration = weapon.penetration;
      this.tabulateDeckTotals();
      var aDamages = weapon.getDamageArray();
      var nDamage = aDamages[Math.round(this.calculateDistance(weapon.ship))];
      for (let ix in this.decks) {
        if (nPenetration > 0 && this.decks[ix].total) {
          var nRandSys = Math.floor(Math.random() * this.decks[ix].length);
          while (!this.decks[ix][nRandSys % this.decks[ix].length].momentary) {
            nRandSys += 1;
          }
          if (weapon.charge && this.decks[ix][nRandSys]) {
            weapon.charge = this.decks[ix][nRandSys].damage(nDamage * weapon.charge / weapon.loaded);
          }
          --nPenetration;
        }
      }
    };
    Ship.prototype.takeFireInOrder = function(weapon) {
      var nPenetration = weapon.penetration;
      this.tabulateDeckTotals();
      for (let ix in this.decks) {
        if (!nPenetration) {
          break;
        }
        for (let sys in this.decks[ix]) {
          if (weapon.charge && this.decks[ix][sys]) {
            weapon.charge = this.decks[ix][sys].damage(weapon.charge);
            break;
          }
        }
        --nPenetration;
      }
    };
    Ship.prototype.getSpeed = function() {
      return Math.floor(
        ((this.warp.actual + 1) * 3 + this.impulse.actual * 4) *
        this.speedBoost / Math.pow(this.hull.initial, 1.25)
      );
    };
    Ship.prototype.getVeer = function() {
      return { 'S': 130, 'M': 110, 'L': 90 }[this.size] + this.veerAdjust + this.helm.crew.perq;;
    };
    Ship.prototype.getPointValue = function() { // to do: advanced wpns / overload
      return Math.round(
        this.shields.initial * 5 +
        this.hull.initial * 4 +
        this.impulse.initial * 2.5 +
        this.warp.initial * 2.75 +
        this.sensors.initial * 1 +
        this.control.initial * 1.5 +
        this.deflectors.initial * 2 +
        this.engineering.initial * 1 +
        this.helm.initial * 1 +
        this.navigation.initial * 1 +
        this.command.initial * 1 +
        this.tactical.initial * 1 +
        this.science.initial * 1 +
        this.primary.initial * 3 +
        this.secondary.initial * 3 +
        this.veerAdjust * .15 +
        (this.speedBoost - 1) * 5
      );
    };
    Ship.prototype.getIntegrity = function() {
      return Math.round((
        this.shields.initial +
        this.hull.initial +
        this.impulse.initial +
        this.warp.initial +
        this.sensors.initial +
        this.control.initial +
        this.deflectors.initial +
        this.engineering.initial +
        this.helm.initial +
        this.navigation.initial +
        this.command.initial +
        this.tactical.initial +
        this.science.initial +
        this.primary.initial +
        this.secondary.initial
        ) / (
        this.shields.actual +
        this.hull.actual +
        this.impulse.actual +
        this.warp.actual +
        this.sensors.actual +
        this.control.actual +
        this.deflectors.actual +
        this.engineering.actual +
        this.helm.actual +
        this.navigation.actual +
        this.command.actual +
        this.tactical.actual +
        this.science.actual +
        this.primary.actual +
        this.secondary.actual
      ) * 100);
    };
    Ship.prototype.getThreat = function() {
      if (master.self.shipFocus) {
        var nThreat = Math.pow(this.getPointValue() * this.getIntegrity() / master.self.shipFocus.getPointValue(), 2);
        return nThreat < 5000 ? 'low' : nThreat < 12000 ? 'moderate' : nThreat < 20000 ? 'high' : 'extreme';
      } else {
        return 'indeterm.';
      }
    };
    Ship.prototype.launch = function() { // initial all systems
      if (this.isReady()) {
        for (let member in this) {
          if (this[member].initialize) {
            this[member].initialize();
          }
        }
      } else {
        console.error('Ship is not ready to launch:', this);
      }
      return this;
    };
    Ship.prototype.turnOfEvents = function() {
      for (let member in this) {
        // damage
        if (this[member].initial) {
          this[member].actual = this[member].momentary;
        }
        // charge
        if (this[member].augmentCharge) {
          this[member].augmentCharge();
        }
      }
      // repair
      this.shields.repair();
      this.hull.repair();
    };
    Ship.prototype.output = function() {
      if (!this.panel.elem.innerHTML) {
        this.createBrief();
        for (let deck in this.decks) {
          for (let sys in this.decks[deck]) {
            this.panel[this.decks[deck][sys].id] = this.decks[deck][sys].createReadout();
          }
        }
        master.pane.elem.appendChild(this.panel.elem);
      }
      for (let ix = 0; ix < master.pane.elem.children.length; ++ix) {
        master.pane.elem.children[ix].id = (master.pane.elem.children[ix] === this.panel.elem ? 'active' : '');
      }
      for (let deck in this.decks) {
        for (let sys in this.decks[deck]) {
          if (this.decks[deck][sys].updateReadout) {
            this.decks[deck][sys].updateReadout();
          }
        }
      }
    };
    Ship.prototype.createBrief = function() {
      if (!(this.brief && this.brief.elem)) {
        this.brief = new Brief;
        this.brief.ident = document.createElement('div');
        this.brief.ident.appendChild(document.createTextNode(this.prefix + ' ' + this.name));
        this.brief.elem.appendChild(this.brief.ident);
        this.brief.type = document.createElement('div');
        this.brief.type.appendChild(document.createTextNode(this.classification));
        this.brief.elem.appendChild(this.brief.type);
        this.brief.stats = document.createElement('div');
        this.brief.stats.innerHTML = 'speed: <b>' + this.getSpeed() + '</b> &nbsp; ';
        this.brief.stats.innerHTML += 'maneuver: <b>' + this.getVeer() + '&deg;</b>';
        this.brief.elem.appendChild(this.brief.stats);
        this.brief.wpns = document.createElement('div');
        this.brief.wpns.innerHTML = this.primary.shortName + ': <b>' + this.primary.charge + '</b> &nbsp; ';
        this.brief.wpns.innerHTML += this.secondary.shortName + ': <b>' + this.secondary.charge + '</b>';
        this.brief.elem.appendChild(this.brief.wpns);
        this.brief.svg = createElementNS();
        this.brief.svg.icon = createElementNS('g');
        this.brief.svg.icon.insertAdjacentHTML('beforeend', this.xml, 'image/svg+xml');
        this.brief.svg.icon.setAttribute('transform', 'rotate(270 50 61) scale(1.2, 1.2)');
        this.brief.svg.setAttribute('class', 'image');
        this.brief.svg.setAttribute('viewBox', '0 0 100 100');
        this.brief.svg.appendChild(this.brief.svg.icon);
        this.brief.elem.appendChild(this.brief.svg);
        this.panel.elem.appendChild(this.brief.elem);
      }
    };
    Ship.prototype.outputTerse = function() {
      if (!this.terse.elem.innerHTML) {
        this.createScan();
        master.face.elem.appendChild(this.terse.elem);
      }
      for (let ix = 0; ix < master.face.elem.children.length; ++ix) {
        master.face.elem.children[ix].style.display = (master.face.elem.children[ix] === this.terse.elem ? 'block' : 'none');
      }
    };
    Ship.prototype.createScan = function() {
      if (!(this.scan && this.scan.elem)) {
        this.scan = new Brief;
        this.scan.ident = document.createElement('div');
        this.scan.ident.appendChild(document.createTextNode(this.prefix + ' ' + this.name));
        this.scan.elem.appendChild(this.scan.ident);
        this.scan.type = document.createElement('div');
        this.scan.type.appendChild(document.createTextNode(this.classification));
        this.scan.elem.appendChild(this.scan.type);
        this.scan.stats = document.createElement('div');
        this.scan.stats.innerHTML = 'speed: <b>' + this.getSpeed() + '</b> &nbsp; ';
        this.scan.stats.innerHTML += 'threat: <b>' + this.getThreat() + '</b>';
        this.scan.elem.appendChild(this.scan.stats);
        this.scan.integ = document.createElement('div');
        this.scan.integ.innerHTML = 'structural integrity: <b>' + this.getIntegrity() + '%</b>';
        this.scan.elem.appendChild(this.scan.integ);
        this.scan.svg = createElementNS();
        this.scan.svg.icon = createElementNS('g');
        this.scan.svg.icon.insertAdjacentHTML('beforeend', this.xml, 'image/svg+xml');
        this.scan.svg.icon.setAttribute('transform', 'rotate(90 61 51) scale(1.2, 1.2)');
        this.scan.svg.setAttribute('class', 'image');
        this.scan.svg.setAttribute('viewBox', '0 0 100 100');
        this.scan.svg.appendChild(this.scan.svg.icon);
        this.scan.elem.appendChild(this.scan.svg);
        this.terse.elem.appendChild(this.scan.elem);
      }
    };
    // END Ship()

    function Warship(specs = {}) {
      Object.assign(specs, oShipHulls[specs.society.name][specs.type]);
      if (!specs.size) {
        console.error('Ship of type "' + specs.type + '" cannot be deployed.');
        return null;
      }
      Ship.call(this, specs);
      specs.primary = Object.assign({ship: this, initial: specs.primaryInitial}, specs.primaryOverride);
      specs.secondary = Object.assign({ship: this, initial: specs.secondaryInitial}, specs.secondaryOverride);
      this.idPrefix = specs.idPrefix;
      this.type = specs.type;
      this.size = specs.size;
      this.speedBoost = specs.speedBoost || 1;
      this.veerAdjust = specs.veerAdjust || 0;
      this.classification = specs.classification || 'unknown class';
      this.prefix = this.society.prefix;
      this.name = specs.name || oShipNames.christen(this.society.name, this.size);
      this.primary = new this.society.primary(specs.primary);
      this.secondary = new this.society.secondary(specs.secondary);
      this.launch();
    }
    Warship.prototype = new Ship;
    // END Warship()
    /** END ships **/

    /** systems **/
    function System(specs = {}) { // super
      this.ship = specs.ship;
      this.name = 'system';
      this.shortName = 'system';
      this.increment = 1;
      this.crew = null;
      this.ready = false;
      this.readout = null;
      this.facia = new Facia;
    }
    System.prototype.isReady = function() {
      var bReady = true;
      for (let member in this) {
        bReady *= (this[member] !== null && typeof this[member] !== 'undefined');
      }
      return this.ready = !!bReady;
    };
    System.prototype.initialize = function() {
      this.ship.decks[this.deck].push(this);
      return this.momentary = this.actual = this.initial;
    };
    System.prototype.initializeShields = function() {
      this.ship.decks[this.deck].push(this);
      this.momentary = this.actual = this.initial;
      return this.momentary += this.ship.deflectors.crew.perq;
    };
    System.prototype.damage = function(amount) {
      amount = Number(amount);
      --this.momentary;
      this.informHit(1);
      if (this.momentary <= 0) {
        this.momentary = 0;
        this.informDestroyed();
      }
      return amount - 1;
    };
    System.prototype.damageMany = function(amount) {
      amount = Number(amount);
      var nMomentary = this.momentary;
      nMomentary -= amount;
      if (nMomentary <= 0) {
        var nRemainder = amount - this.momentary;
        this.informHit(this.momentary);
        this.momentary = 0;
        this.informDestroyed();
        return nRemainder;
      } else {
        this.informHit(amount);
        this.momentary -= amount;
        return 0;
      }
    };
    System.prototype.informHit = function(amount) {
      console.log(this.name + ' hit for ' + amount + ': ' + this.momentary + '.');
    };
    System.prototype.repair = function(amount = 0) { // post-damage
      this.actual += amount;
      this.momentary = this.actual = Math.round(this.actual);
      if (this.actual > this.initial) {
        this.momentary = this.actual = this.initial;
      }
      this.momentary += this.ship.deflectors.crew.perq;
    };
    System.prototype.repairHull = function() { // post-damage
      this.actual += Number(this.ship.control.crew.perq);
      this.momentary = this.actual = Math.round(this.actual);
      if (this.actual > this.initial) {
        this.momentary = this.actual = this.initial;
      }
    };
    System.prototype.repairShields = function() { // post-damage
      this.actual += Math.ceil((this.initial - this.actual) / 2);
      this.momentary = this.actual + Number(this.ship.deflectors.crew.perq);
      if (this.actual > this.initial) {
        this.momentary = this.actual = this.initial;
      }
    };
    System.prototype.output = function() {
      if (!this.facia.elem.innerHTML) {
        this.createBreakdown();
        master.face.elem.appendChild(this.facia.elem);
      }
      for (let ix = 0; ix < master.face.elem.children.length; ++ix) {
        master.face.elem.children[ix].style.display = (master.face.elem.children[ix] === this.facia.elem ? 'block' : 'none');
      }
    };
    System.prototype.createBreakdown = function() {
      if (!(this.breakdown && this.breakdown.elem)) {
        this.breakdown = new Brief;
        this.breakdown.elem.classList.add('breakdown');
        this.breakdown.elem.classList.add(this.id);
        this.breakdown.ident = document.createElement('div');
        this.breakdown.ident.appendChild(document.createTextNode(this.name));
        this.breakdown.ident.innerHTML += ' &nbsp; (<b>' + Math.round(this.momentary / this.initial * 100) + '%</b> integrity)';
        this.breakdown.elem.appendChild(this.breakdown.ident);
        if (this.loaded) {
          this.breakdown.load = document.createElement('div');
          this.breakdown.load.innerHTML += 'charge: <b>' + Math.round(this.charge / this.loaded * 100) + '%</b>';
          if (this.loaded <= this.charge) {
            this.breakdown.load.innerHTML += ' &nbsp; (<b>ready</b>)';
          }
          if (this.loaded < this.charge) {
            this.breakdown.load.innerHTML += '&nbsp; &nbsp; (<b>overloaded</b>)';
          }
          this.breakdown.elem.appendChild(this.breakdown.load);
        }
        if (this.crew && this.crew.position) {
          this.breakdown.off = document.createElement('div');
          this.breakdown.off.appendChild(document.createTextNode(this.crew.position));
          this.breakdown.off.innerHTML += ' @ ' + this.crew.station;
          this.breakdown.stat = document.createElement('div');
          this.breakdown.stat.innerHTML += '<b>' + this.crew.experience+ '</b> experience &nbsp; (<b>' + (this.crew.alive ? 'alive' : 'unconscious') + '</b>)';
          if (this.crew.healthy) {
            this.breakdown.stat.innerHTML += ' &nbsp; (<b>healthy</b>)';
          }
          this.breakdown.elem.appendChild(this.breakdown.off);
          this.breakdown.elem.appendChild(this.breakdown.stat);
        }
        this.facia.elem.appendChild(this.breakdown.elem);
      }
    };
    System.prototype.informDestroyed = function() {
      this.momentary = this.actual = 0;
      if (this.crew) {
        this.crew.incapacitate();
      }
      console.log(this.name + ' systems destroyed!');
    };
    System.prototype.hushDestroyed = function() {
      this.momentary = this.actual = 0;
      console.log(this.name + ' down!');
    };
    System.prototype.informShipDestroyed = function() {
      console.log(this.ship.prefix + ' ' + this.ship.name + ' destroyed!');
      // this.ship.elem.parentNode.removeChild(this.ship.elem);
      // delete this.ship; -OR-
      // releaseEvent();
    };
    System.prototype.createReadout = function() {
      if (!(this.readout && this.readout.elem)) {
        this.readout = new Readout;
        this.readout.elem.setAttribute('class', 'sys-' + this.id); // no longer ID
        if (this.cluster) {
          if (!this.ship.panel.elem.containers[this.cluster]) {
            this.ship.panel.elem.containers[this.cluster] = document.createElement('div');
            this.ship.panel.elem.containers[this.cluster].setAttribute('class', 'cluster');
            this.ship.panel.elem.appendChild(this.ship.panel.elem.containers[this.cluster]);
          }
          var container = this.ship.panel.elem.containers[this.cluster];
        } else {
          var container = this.ship.panel.elem;
        }
        this.readout.elem.label = document.createElement('span');
        if (this.initial) {
          this.readout.elem.label.innerHTML = this.name;
          this.readout.elem.appendChild(this.readout.elem.label);
          registerEvent(this.readout.elem, 'click', this.output.bind(this));
        }
        if (this.numeral) {
          this.readout.elem.label.deck = document.createElement('b');
          this.readout.elem.label.deck.setAttribute('title', 'DECK LEVEL ' + this.numeral);
          this.readout.elem.label.deck.innerHTML = this.numeral;
          this.readout.elem.label.appendChild(this.readout.elem.label.deck);
        }
        if (this.initial) {
          for (let ix = 0; ix < this.actual; ++ix) {
            this.readout.elem.fractions[ix] = document.createElement('div');
            this.readout.elem.fractions[ix].style.width = 100 / this.initial + '%';
            this.readout.elem.appendChild(this.readout.elem.fractions[ix]);
          }
        } else {
          this.readout.elem.fractions[0] = document.createElement('div');
          this.readout.elem.classList.add('empty');
          this.readout.elem.fractions[0].classList.add('empty');
          this.readout.elem.appendChild(this.readout.elem.fractions[0]);
        }
      }
      return container.appendChild(this.readout.elem);
    };
    System.prototype.updateReadout = function() {
      var cDivs = this.readout.elem.getElementsByTagName('div'),
          eDiv,
          ix = 0;
      while (eDiv = cDivs[ix++]) {
        if (this.actual < ix) {
          eDiv.style.background = 'transparent';
        }
      }
    };
    // END System()

    function Weapon() {
      System.call(this);
      this.penetration = 3;
      this.name = 'weapon';
      this.shortName = 'weapon';
      this.arc = 0;
      this.active = false;
      this.charge = 0;
      this.loaded = 1
      this.overloaded = 1;
      this.increment = 1;
      this.elems = [];
    }
    Weapon.prototype = new System;
    Weapon.prototype.augmentCharge = function() {
      this.charge += this.increment;
      if (this.charge > this.overloaded) {
        this.charge = this.overloaded;
      }
    };
    Weapon.prototype.fireReady = function() {
      return this.actual && this.charge >= this.loaded;
    };
    Weapon.prototype.getDamageArray = function() {
      var aDamages = [],
          ix = 0,
          nLethal = this.lethality,
          nExcess = Math.sqrt(this.charge / this.loaded);
      while (ix < 15) {
        aDamages[ix++] = Math.round(nLethal * nExcess);
        nLethal /= this.attenuation;
      }
      aDamages = aDamages.slice(0, aDamages.indexOf(0));
      if (this.rangeMin) {
        aDamages.fill(0, 0, this.rangeMin);
      }
      if (this.rangeMax) {
        aDamages = aDamages.slice(0, this.rangeMax);
      }
      return aDamages;
    };
    Weapon.prototype.showArc = function() {
      this.active = true;
      var aDamages = this.getDamageArray(),
          nMaxDamage = Math.max(...aDamages),
          aArcRanges = [],
          to,
          from,
          toHold,
          fromHold;
      for (let dmg = nMaxDamage; dmg > 0; --dmg) {
        fromHold = fromHold || from;
        toHold = toHold || to;
        from = aDamages.indexOf(dmg);
        to = aDamages.lastIndexOf(dmg);
        if (from > -1 && to > -1) {
          this.elems[dmg - 1] = master.symbols.add('arcs', new Arc({ weapon: this, from: from, to: to + 1 }));
        } else if (fromHold && toHold) {
          this.elems[dmg - 1] = master.symbols.add('arcs', new Arc({ weapon: this, from: fromHold, to: toHold + 1 }));
        }
      }
      this.fromHold = this.toHold = null;
    };
    Weapon.prototype.isInArc = function(thatShip = master.self.shipTarget) {
      var x1 = this.ship.coords['x'],
          y1 = this.ship.coords['y'],
          x2 = thatShip.coords['x'],
          y2 = thatShip.coords['y'],
          distance = this.ship.calculateDistance(thatShip),
          targetAngle = (Math.atan2((y1 - y2), (x1 - x2)) * 180 / Math.PI + 630 - this.ship.orient) % 360, // 0-360 from bow despite grid rotation
          bInArc = 180 - Math.abs(targetAngle - 180) <= this.arc / 2; // angle off bow within half an arc
      if (bInArc && distance >= this.rangeMin && distance <= this.rangeMax) {
        return true;
      } else {
        return false;
      }
    };
    Weapon.prototype.fire = function(thatShip = master.self.shipTarget) {
      if (this.fireReady() && this.isInArc(thatShip)) {
        var aDamages = this.getDamageArray();
        thatShip.takeFire(this);
        this.charge = 0;
        playTones(this.sound);
      }
    };
    Weapon.prototype.render = function(thatShip, color = 'yellow') {
      master.symbols.removeAll('arcs');
      var x1, y1, x2, y2;
      var line = createElementNS('line');
      [x1, y1] = [this.ship.coords['x'], this.ship.coords['y']];
      [x2, y2] = [thatShip.coords['x'], thatShip.coords['y']];
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke-width', 5);
      line.setAttribute('stroke', color);
      master.grid.elem.insertBefore(line, master.grid.elem.divider);
      renderFire(line, 40);
      function renderFire(elem, prog) {
        var nOpacity = prog % 5 ? prog / 40 : 0;
        elem.setAttribute('opacity', nOpacity);
        if (--prog > 0) {
          return setTimeout(() => renderFire(elem, prog), 20);
        } else {
          master.grid.elem.removeChild(elem);
          return;
        }
      }
    };
    // END Weapon()

    function Primary(specs = {}) {
      Weapon.call(this, specs);
      this.id = 'primary';
      this.ship = specs.ship;
      this.deck = 3;
      this.cluster = 'isp';
      this.range = specs.range || 1;
      this.arc = specs.arc || 120;
      this.increment = specs.increment || 1;
      this.color = '#eeff00';
    }
    Primary.prototype = new Weapon;
    // END Primary()

    function Secondary(specs = {}) {
      Weapon.call(this, specs);
      this.id = 'secondary';
      this.ship = specs.ship;
      this.deck = 3;
      this.cluster = 'isp';
      this.range = specs.range || 1;
      this.arc = specs.arc || 90;
      this.increment = specs.increment || 1;
      this.color = '#ff0066';
    }
    Secondary.prototype = new Weapon;
    // END Secondary()

    function Hull(specs = {}) {
      System.call(this, specs);
      this.initial = specs.hull || 1;
      this.id = 'hull';
      this.name = 'hull';
      this.shortName = 'hull';
      this.deck = 1;
      this.numeral = 'II';
    }
    Hull.prototype = new System;
    Hull.prototype.repair = Hull.prototype.repairHull;
    Hull.prototype.informDestroyed = Hull.prototype.hushDestroyed;
    // END Hull()

    function Shields(specs = {}) {
      System.call(this, specs);
      this.initial = specs.shields || 0;
      this.id = 'shields';
      this.name = 'shields';
      this.shortName = 'shields';
      this.deck = 0;
      this.numeral = 'I';
    }
    Shields.prototype = new System;
    Shields.prototype.initialize = Shields.prototype.initializeShields;
    Shields.prototype.damage = Shields.prototype.damageMany;
    Shields.prototype.repair = Shields.prototype.repairShields;
    Shields.prototype.informDestroyed = Shields.prototype.hushDestroyed;
    // END Shields()

    function Impulse(specs = {}) {
      System.call(this, specs);
      this.initial = specs.impulse || 0;
      this.id = 'impulse';
      this.name = 'impulse engines';
      this.shortName = 'impulse';
      this.deck = 3;
      this.numeral = 'IV';
      this.cluster = 'isp';
    }
    Impulse.prototype = new System;
    // END Impulse()

    function Warp(specs = {}) {
      System.call(this, specs);
      this.initial = specs.warp || 0;
      this.id = 'warp';
      this.name = 'warp engines';
      this.shortName = 'warp';
      this.deck = 5;
      this.numeral = 'VI';
    }
    Warp.prototype = new System;
    Warp.prototype.damage = Warp.prototype.damageMany;
    Warp.prototype.informDestroyed = Warp.prototype.informShipDestroyed;
    // END Warp()

    function Deflectors(specs = {}) {
      System.call(this, specs);
      this.initial = specs.deflectors || 0;
      this.id = 'deflectors';
      this.name = 'deflectors';
      this.shortName = 'deflectors';
      this.deck = 2;
      this.numeral = 'III';
      this.cluster = 'dsc';
      this.crew = new Officer({perq: 1});
    }
    Deflectors.prototype = new System;
    // END Deflectors()

    function DamageControl(specs = {}) {
      System.call(this, specs);
      this.initial = specs.control || 0;
      this.id = 'control';
      this.name = 'damage control';
      this.shortName = 'dmg ctrl';
      this.deck = 2;
      this.cluster = 'dsc';
      this.crew = new Officer({perq: 1});
    }
    DamageControl.prototype = new System;
    // END DamageControl()

    function Sensors(specs = {}) {
      System.call(this, specs);
      this.initial = specs.sensors || 0;
      this.id = 'sensors';
      this.name = 'sensors';
      this.shortName = 'sensors';
      this.deck = 2;
      this.cluster = 'dsc';
      this.crew = new Officer({perq: 1});
    }
    Sensors.prototype = new System;
    // END Sensors()

    function Station(specs = {}) {
      System.call(this, specs);
      this.initial = specs.initial || 1;
      this.name = this.shortName = specs.name || 'crewman';
      this.station = specs.station || 'operations';
      this.deck = 4;
    }
    Station.prototype = new System;
    // END Station()
    /** END systems **/


    /** subsystems **/
    function Phaser(specs = {}) {
      Primary.call(this, specs);
      this.initial = specs.initial || 0;
      this.name = this.shortName = specs.name || 'phasers';
      this.rangeMax = specs.rangeMax || 10;
      this.rangeMin = specs.rangeMin || 0;
      this.attenuation = specs.attenuation || 1.06;
      this.lethality = specs.lethality || 2;
      this.loaded = specs.loaded || 1;
      this.overloaded = specs.overloaded || 1;
      this.penetration = specs.penetration || 3;
      this.arc = specs.arc || 120;
      this.sound = { tones: [675, 725, 650, 750, 675, 725, 650, 750, 675, 725, 650, 750, 675, 725, 650, 750, 675, 725, 650, 750, 675, 750, 650, 725, 675, 750], duration: 500, type:'sine' };
      this.increment = specs.increment || 1;
      this.charge = 0;
    }
    Phaser.prototype = new Primary;
    Phaser.prototype.render = function(thatShip, color = '#8080ff') {
      master.symbols.removeAll('arcs');
      var x1, y1, x2, y2;
      var line = createElementNS('line');
      [x1, y1] = [this.ship.coords['x'], this.ship.coords['y']];
      [x2, y2] = [thatShip.coords['x'], thatShip.coords['y']];
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', color);
      master.grid.elem.insertBefore(line, master.grid.elem.divider);
      renderFire(line, 60);
      function renderFire(elem, prog) {
        var nOpacity = prog / 50;
        elem.setAttribute('opacity', nOpacity);
        elem.setAttribute('stroke-width', prog % 5 + 2);
        if (--prog > 0) {
          return setTimeout(() => renderFire(elem, prog), 20);
        } else {
          master.grid.elem.removeChild(elem);
          return;
        }
      }
    };
    // END Phaser()

    function Disruptor(specs = {}) {
      Primary.call(this, specs);
      this.initial = specs.initial || 0;
      this.name = specs.name || 'disruptor array';
      this.shortName = 'disruptors';
      this.rangeMax = specs.rangeMax || 8;
      this.rangeMin = specs.rangeMin || 0;
      this.attenuation = specs.attenuation || 1.19;
      this.lethality = specs.lethality || 3;
      this.loaded = specs.loaded || 1;
      this.overloaded = specs.overloaded || 2;
      this.penetration = specs.penetration || 2;
      this.arc = specs.arc || 120;
      this.sound = { tones: [440, 330, 220, 110, 440, 330, 220, 110, 440, 330, 220, 110, 440, 330, 220, 110, 440, 330, 220, 110], duration: 500, type:'sine' };
      this.increment = specs.increment || 1;
      this.charge = 0;
    }
    Disruptor.prototype = new Primary;
    Disruptor.prototype.render = function(thatShip) {
      master.symbols.removeAll('arcs');
      var x1, y1, x2, y2;
      var line = createElementNS('line');
      [x1, y1] = [this.ship.coords['x'], this.ship.coords['y']];
      [x2, y2] = [thatShip.coords['x'], thatShip.coords['y']];
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke-width', 3);
      line.setAttribute('stroke', 'lime');
      master.grid.elem.insertBefore(line, master.grid.elem.divider);
      renderFire(line, 100);
      function renderFire(elem, prog) {
        elem.setAttribute('stroke-dasharray',  Math.abs(50 - prog));
        prog -= 5;
        if (prog > 0) {
          return setTimeout(() => renderFire(elem, prog), 25);
        } else {
          master.grid.elem.removeChild(elem);
          return;
        }
      }
    };
    // END Disruptor()

    function Photon(specs = {}) {
      Secondary.call(this, specs);
      this.name = specs.name || 'photon torpedoes';
      this.shortName = 'photons';
      this.initial = specs.initial || 0;
      this.rangeMax = specs.rangeMax || 8;
      this.rangeMin = specs.rangeMin || 2;
      this.attenuation = specs.attenuation || 1;
      this.lethality = specs.lethality || 3;
      this.loaded = specs.loaded || 2;
      this.overloaded = specs.overloaded || 2;
      this.penetration = specs.penetration || 3;
      this.arc = specs.arc || 60; // ship-specific?
      this.sound = { tones: [779, 702, 631, 568, 511, 460, 414, 373, 335, 302, 272, 244, 220, 198, 178, 160, 144, 130, 117, 105], duration: 600, type:'sine' };
      this.increment = specs.increment || 1;
      this.charge = 0;
    }
    Photon.prototype = new Secondary;
    Photon.prototype.render = function(thatShip) {
      master.symbols.removeAll('arcs');
      var x, y, x1, y1, x2, y2, cyan;
      var elem = createElementNS('g');
      var circle = createElementNS('circle');
      [x1, y1] = [this.ship.coords['x'], this.ship.coords['y']];
      [x2, y2] = [thatShip.coords['x'], thatShip.coords['y']];
      circle.setAttribute('cx', x1);
      circle.setAttribute('cy', y1);
      circle.setAttribute('r', 3);
      circle.setAttribute('fill', 'rgb(255, 0, 0)');
      elem.appendChild(circle);
      master.grid.elem.insertBefore(circle, master.grid.elem.divider);
      var prog = 0,
          angle = Math.atan2((y1 - y2), (x1 - x2)) * 180 / Math.PI,
          dist = Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
      movePortion(circle, prog);
      function movePortion(elem, prog) {
        prog += 6;
        x = x1 - prog * Math.cos(Math.PI * angle / 180);
        y = y1 - prog * Math.sin(Math.PI * angle / 180);
        if (prog < dist) {
          cyan = Math.round(Math.abs((prog % 60) - 30) * 8);
          elem.setAttribute('fill', 'rgb(255, ' + cyan + ',' + cyan + ')');
          elem.setAttribute('cx', x);
          elem.setAttribute('cy', y);
          if (prog > dist * .9) {
            elem.setAttribute('r', prog - dist * .9);
          }
          return setTimeout(() => movePortion(elem, prog), 20);
        } else {
          master.grid.elem.removeChild(elem);
          return;
        }
      }
    };
    // END Photon()

    function Pulse(specs = {}) {
      Secondary.call(this, specs);
      this.initial = specs.initial || 0;
      this.name = specs.name || 'pulse cannon';
      this.shortName = 'pulse';
      this.rangeMax = specs.rangeMax || 10;
      this.rangeMin = specs.rangeMin || 0;
      this.attenuation = specs.attenuation ||  1.175;
      this.lethality = specs.lethality || 2.45;
      this.loaded = specs.loaded || 1;
      this.overloaded = specs.overloaded || 3; // ship-specific?
      this.penetration = specs.penetration || 4;
      this.arc = specs.arc || 45;
      this.sound = { tones: [175, 0, 250, 0, 175, 0, 250, 0, 175, 0, 250, 0, 175, 0, 250, 0, 175, 0, 250, 0, 175, 0, 250, 0, 175, 0, 250, 0], duration: 500, type:'sine' };
      this.increment = specs.increment || 1;
      this.charge = 0;
    }
    Pulse.prototype = new Secondary;
    Pulse.prototype.render = function(thatShip) {
      master.symbols.removeAll('arcs');
      var x1, y1, x2, y2;
      [x1, y1] = [this.ship.coords['x'], this.ship.coords['y']];
      [x2, y2] = [thatShip.coords['x'], thatShip.coords['y']];
      var path = createElementNS('path'),
          angle = Math.atan2((x1 - x2), (y1 - y2)) * 180 / Math.PI,
          dist = this.ship.calculateDistance(thatShip),
          x = dist * Math.cos(Math.PI * (angle / 180)),
          y = dist * Math.sin(Math.PI * (angle / 180)),
          draw = 'M' + x1 + ',' + y1 + ' L' + (x2 - x) + ',' + (y2 - y) + ' L' + (x2 + x) + ',' + (y2 + y) + ' Z';
      path.setAttribute('d', draw);
      path.setAttribute('fill', 'rgba(255, 240, 0, .67)');
      master.grid.elem.insertBefore(path, master.grid.elem.divider);
      renderFire(path, 40);
      function renderFire(elem, prog) {
        var nOpacity = prog % 5 ? prog / 40 : 0;
        elem.setAttribute('opacity', nOpacity);
        if (--prog > 0) {
          return setTimeout(() => renderFire(elem, prog), 20);
        } else {
          master.grid.elem.removeChild(elem);
          return;
        }
      }
    };
    // END Pulse()

    /*
    Navigation +0 speed .
    Engineering +0 wpn dist .
    Dmg Control +1 hull.
    Helm +15• turn arcs .
    Sensors +1 penetration .
    Deflectors +1 shields .
    */
    function Engineering(specs = {}) {
      Station.call(this, specs);
      this.initial = specs.initial || 1;
      this.id = 'engineering'
      this.name = specs.name || 'engineering';
      this.crew = specs.crew || new Officer({ position: 'chief engineer', perq: 1 });
      this.cluster = 'sne';
    }
    Engineering.prototype = new Station;
    // END Engineering()

    function Navigation(specs = {}) {
      Station.call(this, specs);
      this.initial = specs.initial || 1;
      this.id = 'navigation'
      this.name = specs.name || 'navigation';
      this.crew = specs.crew || new Officer({ position: 'navigator', perq: 1 });
      this.cluster = 'sne';
    }
    Navigation.prototype = new Station;
    // END Navigation()

    function Science(specs = {}) {
      Station.call(this, specs);
      this.initial = specs.initial || 1;
      this.id = 'science'
      this.name = specs.name || 'science station';
      this.crew = specs.crew || new Officer({ position: 'science officer', perq: 1 });
      this.cluster = 'sne';
    }
    Science.prototype = new Station;
    // END Science()

    function Helm(specs = {}) {
      Station.call(this, specs);
      this.initial = specs.initial || 1;
      this.id = 'helm'
      this.name = specs.name || 'helm';
      this.crew = specs.crew || new Officer({ position: 'helmsman', perq: 10 });
      this.cluster = 'thc';
    }
    Helm.prototype = new Station;
    // END Helm()

    function Command(specs = {}) {
      Station.call(this, specs);
      this.id = 'command'
      this.initial = specs.initial || 1;
      this.name = specs.name || 'command station';
      this.crew = specs.crew || new Officer({ position: 'captain', perq: 1 });
      this.cluster = 'thc';
    }
    Command.prototype = new Station;
    // END Command()

    function Tactical(specs = {}) {
      Station.call(this, specs);
      this.id = 'tactical'
      this.initial = specs.initial || 1;
      this.name = specs.name || 'tactical station';
      this.crew = specs.crew || new Officer({ position: 'first officer', perq: 1 });
      this.numeral = 'V';
      this.cluster = 'thc';
    }
    Tactical.prototype = new Station;
    // END Tactical()
    /** END subsystems **/


    /** crew **/
    function Officer(specs = {}) { // super
      this.position = specs.position || null;
      Object.assign(specs, oOfficers[this.position]);
      this.station = specs.station + ' station';
      this.rank = specs.rank || null;
      this.name = specs.name || null;
      this.perq = specs.perq || 0;
      this.experience = specs.experience || 5;
      this.healthy = specs.healthy || true;
      this.alive = specs.alive || true;
    }
    Officer.prototype.incapacitate = function() {
      this.perq = 0;
    };
    // END Officer()
    /** END crew **/


    /** mod f()s **/
    function createElementNS(elem = 'svg') {
      return document.createElementNS('http://www.w3.org/2000/svg', elem);
    }

    function drawArc(x1from, y1from, x1to, y1to, x2from, y2from, x2to, y2to, distFrom, distTo) {
      return 'M ' + x1from + ',' + y1from + ' L ' + x1to + ',' + y1to + ' A ' + distTo + ',' + distTo + ' 0 0 1 ' + x2to + ',' + y2to + ' L ' + x2from + ',' + y2from + ' A ' + distFrom + ',' + distFrom + ' 0 0 0 ' + x1from + ',' + y1from;
    }

    function stampDate() {
      return (new Date).toString().toLowerCase().replace(/\W/g,'').substr(0,18);
    }

    function getEventCoords(event) { // accounts for browsers' variant matrix math
      var point = master.grid.elem.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      var x = point.matrixTransform(master.grid.elem.getScreenCTM().inverse())['x'];
      var y = point.matrixTransform(master.grid.elem.getScreenCTM().inverse())['y'];
      return [(x + GRID_WIDTH) % GRID_WIDTH, (y + GRID_HEIGHT) % GRID_HEIGHT];
    }

    function playTones(notes = {}, tones = [440], duration = 250, type = 'sine') {
      var tones = notes.tones || tones,
          duration = notes.duration || duration,
          type = notes.type || type,
          context = master.audio,
          source = context.createOscillator();
      source.connect(context.destination);
      source.type = type;
      for (let ix in tones) {
        source.frequency.setValueAtTime(tones[ix], context.currentTime + ix * duration / 1000 / tones.length);
      }
      source.start();
      setTimeout(() => source.stop(), duration);
    }
    /** END mod f()s **/


    /* html elements */
    var eSwapButton = document.getElementById('swap'); // debugging

    /* instantiations */                           
    var master = new MCP();
    master.assignSelf(master.federation);
    master.assignOpponent(master.klingon);
    master.notifyPhase('deploy');

    /* event listeners */
    registerEvent(eSwapButton, 'click', master.swapPlayers.bind(master)); // debugging

  }
  /** END main() **/

  /* f()s available to entire module */
  function registerEvent(eElem, sType, fHandler) { // reforms event listener
    if (eElem.addEventListener) {
      registerEvent = function (eElem, sType, fHandler) {
        eElem.addEventListener(sType, fHandler, false);
      }
    } else {
      registerEvent = function (eElem, sType, fHandler) {
        eElem.attachEvent('on' + sType, fHandler);
      }
    }
    return registerEvent(eElem, sType, fHandler);
  }

  function releaseEvent(eElem, sType, fHandler) { // reforms event destroyer
    if (eElem.removeEventListener) {
      releaseEvent = function (eElem, sType, fHandler) {
        eElem.removeEventListener(sType, fHandler, false);
      }
    } else {
      releaseEvent = function (eElem, sType, fHandler) {
        eElem.detachEvent('on' + sType, fHandler);
      }
    }
    return releaseEvent(eElem, sType, fHandler);
  }

  /* variables available to entire module */
  var oShipNames = {};
  oShipNames.christen = function(sSoc, sSize) { // get, then delete random name
    return (oShipNames[sSoc][sSize].splice(Math.floor(Math.random() * oShipNames[sSoc][sSize].length), 1))[0];
  };
  oShipNames[SOCIETY_UFP] = {
    S: ['Calypso', 'Ceres', 'Dauntless', 'Pioneer', 'Fantasque', 'Farragut', 'Compton', 'Decatur', 'Kearsarge', 'Argonaut', 'Spruance', 'Resolute', 'Lincoln', 'Audacious', 'Endeavor', 'Avernus', 'Renown', 'Triumph', 'Venerable', 'Swiftsure', 'Havock', 'Cochrane', 'Myrmidon', 'Repulse', 'Ptolemy', 'Daedalus', 'Adamant', 'Ranger', 'Constance', 'Dauntless', 'Arethusa', 'Phaeton', 'Calliope', 'Aventine', 'Nimrod', 'Pathfinder', 'Argus', 'Tiberius', 'Keppler', 'Dianthus', 'Messier', 'Formidable', 'Frontier', 'Monitor', 'Reverent', 'Venture', 'Zephyr', 'Concord'],
    M: ['Gallipoli', 'Galatea', 'San Jacinto', 'Calcutta', 'Potemkin', 'New Boston', 'Bonaventure', 'Antietam', 'Canberra', 'Duquesne', 'Lancaster', 'Tripoli', 'Sussex', 'Somerset', 'Sutherland', 'Bainbridge', 'Chevalier', 'Northampton', 'Juneau', 'Savannah', 'Andover', 'Marathon', 'Malta', 'Trafalgar', 'Jutland', 'Normandy', 'Orleans', 'Saladin', 'Tecumseh', 'Troy', 'Callisto', 'Wellington', 'Saratoga', 'Lexington', 'Leyte', 'Agincourt', 'Cheyenne', 'Allegheny', 'Sparta', 'San Francisco', 'Auckland', 'Niagara', 'Cydonia', 'ShirKahr', 'Vorath Sea', 'Aurelia', 'Columbia'],
    L: ['Exeter', 'Neptune', 'Sirius', 'Sovereign', 'Soyuz', 'Ulysses', 'Mars', 'Aurora', 'Procyon', 'Cygnus', 'Centaurus', 'Bolarus', 'Arcturus', 'Rigel', 'Risa', 'Antares', 'Bellatrix', 'Polaris', 'Altair', 'Regulus', 'Superb', 'Hercules', 'Orion', 'Jupiter', 'Odysseus', 'Europa', 'Andromeda', 'Essex', 'Eclipse', 'Prometheus', 'Sentinel', 'Xerxes', 'Olympia', 'Titan', 'Aurelia', 'Aries', 'Perseus', 'Cassiopeia', 'Nebula', 'Trident', 'Andor', 'Tellar', 'Eridanus', 'Vulcanis', 'Union', 'Ascension']
  }
  oShipNames[SOCIETY_KLINGON] = {
    S: ['Y\'tem', 'B\'rel', 'Boqrat', 'Bokor', 'Chontay', 'Ch\'Tang', 'Dakronh', 'Fragh\'ka', 'K\'eylat', 'GuhMoh', 'Balth', 'Jor', 'Kad\'nra', 'Khich', 'Nu\'Tal', 'Kla\'Diyus', 'Korinar', 'Korezima', 'Veng', 'Koroth', 'K\'raiykh', 'Dit\'kra', 'Krogshat', 'Kruge', 'Lingta', 'Lukara', 'Malpara', 'M\'Char', 'Mok\'tal', 'Ning\'tao', 'N\'Kghar', 'Norgh', 'Nukmay', 'Okrona', 'Plath', 'Qaj', 'Qa\'Hom', 'Qovin', 'Rak\'hon', 'Slivin', 'Suqlaw', 'Nu\'paH', 'R\'mora', 'Teghbat', 'To\'baj', 'Rok\'lor', 'Wo\'bortas', 'Chuq\'Beh', 'D\'aka', 'D\'esta Kar', 'Haqtaj'],
    M: ['Kut\'luch', 'Pagh', 'Vakk', 'V\'kar Zadan', 'Buruk', 'Gro\'kan', 'Qin', 'Lara\'atan', 'Khitomer', 'Hegh\'ta', 'K\'vort Cha', 'Birok', 'Ki\'tang', 'Koraga', 'Kormag', 'K\'Ratak', 'Kreltek', 'Rotarran', 'Tagak', 'Taj', 'Vorn', 'Amar', 'Bardur', 'B\'Moth', 'Chargh', 'D\'k\'Tahg', 'Fek\'lhr', 'Hakask', 'K\'elric', 'Klothos', 'Kol\'Targh', 'Korvat', 'K\'ti\'suka', 'N\'Gat', 'Qo\'noS', 'Loknar', 'Tebtivu', 'Terthos', 'Tewniwa', 'T\'Ong', 'Varchas', 'Vo\'taq', 'Ya\'Vang', 'Voq\'leng', 'Chutok', 'D\'ama'],
    L: ['Akva', 'Bortasqu', 'Tor\'Kaht', 'Bej\'joq', 'BighHa', 'Qang', 'Qeh\'Ral', 'K\'mirra', 'Azetbur', 'Ditagh', 'Gorkon', 'Daqchov', 'DaQ\'Qat', 'Drovana', 'Duy\'Hub', 'Mogh', 'Gar\'tukh', 'Kravokh', 'Gr\'oth', 'Kesh', 'Hakkarl', 'Hargh', 'Hej\'leng', 'Kaarg', 'K\'elest', 'Key\'vong', 'Klolode', 'Kohna', 'Mahk\'tar', 'M\'ganath', 'Negh\'Var', 'Qa\'Vak', 'Qu\'Vat', 'Rapache', 'R\'kang', 'Sompek', 'T\'Acog', 'Tcha\'voth', 'T\'Kora', 'Tr\'loth', 'Vor\'nak', 'K\'mpec', 'Vum\'ghargh', 'Ghij', 'Leng', 'Akif', 'Bortas']
  };
  var oWeaponOverrides = {
    phaserX: { // standard Phaser overrides:
      name: 'phaser-X',
      rangeMax: 12,
      rangeMin: 0,
      attenuation: 1.05,
      lethality: 2,
      loaded: 1,
      overloaded: 1
    },
    disruptor3: { // standard Disruptor overrides:
      name: 'dispruptor type-3',
      rangeMax: 6,
      rangeMin: 0,
      attenuation: 1.13,
      lethality: 3.3,
      loaded: 2,
      overloaded: 3
    }
  };
  var oShipHulls = {};
  oShipHulls[SOCIETY_UFP] = {
    DN: {
      classification: 'dreadnought',
      size: 'L',
      hull: 6,
      shields: 6,
      impulse: 6,
      warp: 6,
      deflectors: 3,
      sensors: 2,
      control: 2,
      primaryOverride: oWeaponOverrides['phaserX'],
      primaryInitial: 3,
      secondaryInitial: 3,
      secondaryOverride: null,
      idPrefix: 'fdn_',
      xml:
        '<line x1="35" y1="60" x2="65" y2="60" stroke-width="5" class="fedLow"/>' +
        '<path d="M 62,40 L 55,75 L 45,75 L 38,40 Z" class="fedLow"/>' +
        '<circle cx="50" cy="30" r="21" fill="url(#dish)"/>' +
        '<path d="M 50,43 L 46,31 A 3.5,3.5 0 1 1 54,31 Z" class="fedHigh"/>' +
        '<line x1="33" y1="50" x2="33" y2="90" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<line x1="50" y1="47" x2="50" y2="87" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<line x1="67" y1="50" x2="67" y2="90" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<path d="M 30.5,51 L 35.5,51 A 2.8,3.2 0 1 0 30.5,51 Z" class="fedEngine"/>' +
        '<path d="M 47.5,48 L 52.5,48 A 2.8,3.2 0 1 0 47.5,48 Z" class="fedEngine"/>' +
        '<path d="M 64.5,51 L 69.5,51 A 2.8,3.2 0 1 0 64.5,51 Z" class="fedEngine"/>'
    },
    CA: {
      classification: 'heavy cruiser',
      size: 'L',
      hull: 5,
      shields: 6,
      impulse: 5,
      warp: 6,
      deflectors: 3,
      sensors: 2,
      control: 2,
      primaryOverride: oWeaponOverrides['phaserX'],
      primaryInitial: 3,
      secondaryInitial: 3,
      idPrefix: 'fca_',
      xml:
        '<rect x="35" y="59" width="30" height="5" class="fedLow"/>' +
        '<line x1="50" y1="45" x2="50" y2="69" stroke-width="8" stroke-linecap="round" class="fedLow"/>' +
        '<circle cx="50" cy="30" r="20" fill="url(#dish)"/>' +
        '<path d="M 50,45 L 47,32 A 3.5,3.5 0 1 1 53,32 Z" class="fedHigh"/>' +
        '<line x1="35" y1="50" x2="35" y2="90" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<line x1="65" y1="50" x2="65" y2="90" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<path d="M 32.5,51 L 37.5,51 A 2.8,3.2 0 1 0 32.5,51 Z" class="fedEngine"/>' +
        '<path d="M 62.5,51 L 67.5,51 A 2.8,3.2 0 1 0 62.5,51 Z" class="fedEngine"/>',
    },
    CB: {
      classification: 'battlecruiser',
      size: 'L',
      hull: 5,
      shields: 5,
      impulse: 5,
      warp: 5,
      deflectors: 3,
      sensors: 2,
      control: 2,
      primaryOverride: oWeaponOverrides['phaserX'],
      primaryInitial: 3,
      secondaryInitial: 3,
      idPrefix: 'fcb_',
      xml:
        '<path d="M 44,46 L 56,46 L 63,72 L 56,65 L 50,45 L 44,65 L 37,72 Z" class="fedLow"/>' +
        '<circle cx="50" cy="30" r="20" fill="url(#dish)"/>' +
        '<path d="M 50,45 L 47,32 A 3.5,3.5 0 1 1 53,32 Z" class="fedHigh"/>' +
        '<line x1="37" y1="50" x2="37" y2="90" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<line x1="63" y1="50" x2="63" y2="90" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<path d="M 34.5,51 L 39.5,51 A 2.8,3.2 0 1 0 34.5,51 Z" class="fedEngine"/>' +
        '<path d="M 60.5,51 L 65.5,51 A 2.8,3.2 0 1 0 60.5,51 Z" class="fedEngine"/>'
    },
    CC: {
      classification: 'medium cruiser',
      size: 'L',
      hull: 5,
      shields: 5,
      impulse: 4,
      warp: 5,
      deflectors: 3,
      sensors: 2,
      control: 2,
      primaryOverride: oWeaponOverrides['phaserX'],
      primaryInitial: 3,
      secondaryInitial: 2,
      idPrefix: 'fcc_',
      xml:
        '<rect x="27" y="46" width="46" height="10" class="fedLow"/>' +
        '<line x1="26.5" y1="38" x2="26.5" y2="78" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<line x1="73.5" y1="38" x2="73.5" y2="78" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<path d="M 24,38 L 29,38 A 2.8,3.2 0 1 0 24,38 Z" class="fedEngine"/>' +
        '<path d="M 71,38 L 76,38 A 2.8,3.2 0 1 0 71,38 Z" class="fedEngine"/>' +
        '<path d="M 38,56 L 62,56 A 20,20 0 1 0 38,56 Z" fill="url(#dish)"/>' +
        '<path d="M 50,55 L 47,42 A 3.5,3.5 0 1 1 53,42 Z" class="fedHigh"/>'
    },
    CL: {
      classification: 'light cruiser',
      size: 'M',
      hull: 4,
      shields: 5,
      impulse: 4,
      warp: 4,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 3,
      secondaryInitial: 2,
      idPrefix: 'fcl_',
      xml:
        '<path d="M 32,51 L 32,63 L 50,41 L 68,63 L 68,51 Z" class="fedHigh"/>' +
        '<line x1="32" y1="39" x2="32" y2="81" stroke-width="5" stroke-linecap="round" class="fedLow"/>' +
        '<line x1="68" y1="39" x2="68" y2="81" stroke-width="5" stroke-linecap="round" class="fedLow"/>' +
        '<path d="M 38,54 L 62,54 A 20,20 0 1 0 38,54 Z" fill="url(#dish)"/>' +
        '<path d="M 50,53 L 47,41 A 3.5,3.5 0 1 1 53,41 Z" class="fedHigh"/>'
    },
    DDC: {
      classification: 'corvette',
      size: 'M',
      hull: 4,
      shields: 4,
      impulse: 4,
      warp: 4,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 3,
      secondaryInitial: 2,
      idPrefix: 'fdc_',
      xml:
        '<ellipse cx="50" cy="50" rx="5" ry="9.5" class="fedHigh"/>' +
        '<line x1="42" y1="45" x2="42" y2="80" stroke-width="5" stroke-linecap="round" class="fedLow"/>' +
        '<line x1="58" y1="45" x2="58" y2="80" stroke-width="5" stroke-linecap="round" class="fedLow"/>' +
        '<circle cx="50" cy="35" r="17.5" fill="url(#dish)"/>' +
        '<path d="M 50,46 L 47.5,37 A 3,3 0 1 1 52.5,37 Z" class="fedHigh"/>'
    },
    DD: {
      classification: 'destroyer',
      size: 'M',
      hull: 4,
      shields: 4,
      impulse: 3,
      warp: 4,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 2,
      speedBoost: 1.33,
      idPrefix: 'fdd_',
      xml:
        '<circle cx="50" cy="35" r="16" fill="url(#dish)"/>' +
        '<path d="M 50,44 L 47.5,37 A 3,3 0 1 1 52.5,37 Z" class="fedHigh"/>' +
        '<path d="M 34.5,51 L 46,51 L 34.5,35 Z" class="fedLow"/>' +
        '<path d="M 65.5,51 L 54,51 L 65.5,35 Z" class="fedLow"/>' +
        '<line x1="55" y1="48" x2="55" y2="78" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<line x1="45" y1="48" x2="45" y2="78" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<path d="M 52.5,49 L 57.5,49 A 2.8,3.2 0 1 0 52.5,49 Z" class="fedEngine"/>' +
        '<path d="M 42.5,49 L 47.5,49 A 2.8,3.2 0 1 0 42.5,49 Z" class="fedEngine"/>'
    },
    DDE: {
      classification: 'destroyer escort',
      size: 'M',
      hull: 3,
      shields: 4,
      impulse: 3,
      warp: 3,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 2,
      idPrefix: 'fdde_',
      xml:
        '<circle cx="50" cy="35" r="16" fill="url(#dish)"/>' +
        '<path d="M 50,44 L 47.5,37 A 3,3 0 1 1 52.5,37 Z" class="fedHigh"/>' +
        '<path d="M 34.5,38 L 50,54 L 65.5,38 L 65.5,49 L 50,65 L 34.5,49 Z" class="fedLow"/>' +
        '<line x1="50" y1="50" x2="50" y2="80" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<path d="M 47.5,51 L 52.5,51 A 2.8,3.2 0 1 0 47.5,51 Z" class="fedEngine"/>'
    },
    FF: {
      classification: 'frigate',
      size: 'S',
      hull: 3,
      shields: 3,
      impulse: 3,
      warp: 3,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 2,
      idPrefix: 'fff_',
      xml:
        '<line x1="50" y1="45" x2="50" y2="60" stroke-width="15" stroke-linecap="round" class="fedLow"/>' +
        '<line x1="50" y1="45" x2="50" y2="78" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<circle cx="50" cy="35" r="16" fill="url(#dish)"/>' +
        '<path d="M 50,44 L 47.5,37 A 3,3 0 1 1 52.5,37 Z" class="fedHigh"/>' +
        '<path d="M 47.5,51 L 52.5,51 A 2.8,3.2 0 1 0 47.5,51 Z" class="fedEngine"/>'
    },
    FFL: {
      classification: 'light frigate',
      size: 'S',
      hull: 3,
      shields: 3,
      impulse: 2,
      warp: 3,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 2,
      speedBoost: 1.2,
      idPrefix: 'fffl_',
      xml:
        '<circle cx="50" cy="48" r="10" class="fedLow"/>' +
        '<circle cx="50" cy="35" r="16" fill="url(#dish)"/>' +
        '<path d="M 50,44 L 47.5,37 A 3,3 0 1 1 52.5,37 Z" class="fedHigh"/>' +
        '<line x1="50" y1="50" x2="50" y2="78" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<path d="M 47.5,51 L 52.5,51 A 2.8,3.2 0 1 0 47.5,51 Z" class="fedEngine"/>'
    },
    PC: {
      classification: 'police cutter',
      size: 'S',
      hull: 2,
      shields: 3,
      impulse: 2,
      warp: 3,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 1,
      idPrefix: 'fpc_',
      xml:
        '<path d="M 40,49 L 50,41 L 60,51 A 16,16 0 1 0 40,51 Z" fill="url(#dish)"/>' +
        '<path d="M 50,46 L 47.5,39 A 3,3 0 1 1 52.5,39 Z" class="fedHigh"/>' +
        '<line x1="50" y1="42" x2="50" y2="74" stroke-width="5" stroke-linecap="round" class="fedHigh"/>' +
        '<path d="M 47.5,43 L 52.5,43 A 2.8,3.2 0 1 0 47.5,43 Z" class="fedEngine"/>'
    },
    PG: {
      classification: 'patrol gunship',
      size: 'S',
      hull: 2,
      shields: 3,
      impulse: 2,
      warp: 2,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 1,
      idPrefix: 'ffpg_',
      xml:
        '<line x1="50" y1="50" x2="50" y2="77" stroke-width="5" stroke-linecap="round" class="fedLow"/>' +
        '<path d="M 36.5,35 L 40,52 L 50,50 L 60,52 L 63.5,36 Z" class="fedHigh"/>' +
        '<circle cx="50" cy="35" r="14" fill="url(#dish)"/>' +
        '<path d="M 50,44 L 47.5,37 A 3,3 0 1 1 52.5,37 Z" class="fedHigh"/>'
    },
    SC: {
      classification: 'scout',
      size: 'S',
      hull: 2,
      shields: 2,
      impulse: 2,
      warp: 2,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 1,
      secondaryInitial: 1,
      speedBoost: 1.3,
      idPrefix: 'fsc_',
      xml:
        '<line x1="50" y1="47" x2="50" y2="74" stroke-width="5" stroke-linecap="round" class="fedLow"/>' +
        '<circle cx="50" cy="37.5" r="9.5" fill="url(#dish)"/>' +
        '<path d="M 50,35.5 L 56,24.5 A 14.5,14.5 1 1,1 44,24.5 Z" fill="url(#dish)"/>' +
        '<path d="M 50,47 L 47.5,40 A 3,3 0 1 1 52.5,40 Z" class="fedHigh"/>'
    }
  };
  oShipHulls[SOCIETY_KLINGON] = {
    L15: {
      classification: 'L-15 dreadnought',
      size: 'L',
      hull: 7,
      shields: 6,
      impulse: 6,
      warp: 6,
      deflectors: 3,
      sensors: 2,
      control: 3,
      primaryInitial: 4,
      secondaryInitial: 4,
      veerAdjust: -10,
      idPrefix: 'kl15_',
      xml:
        '<path d="M 50,15 L 53,45 L 59,51 L 41,51 L 47,45 Z" stroke-width="4" class="klingLow"/>' +
        '<path d="M 45.5,24 L 54.5,24 L 59,13 A 7,4 0 1 0 41,13 Z" class="klingHigh"/>' +
        '<line x1="18" y1="61" x2="18" y2="89" stroke-width="4" class="klingLow"/>' +
        '<line x1="82" y1="61" x2="82" y2="89" stroke-width="4" class="klingLow"/>' +
        '<path d="M 50,53 L 64,47 L 81,65 L 81,82 L 50,73 L 19,82 L 19,65 L 36,47 Z" class="klingHigh"/>' +
        '<path d="M 42,61 L 50,63 L 58,61 L 58,78 L 42,78 Z" class="klingLow"/>' +
        '<line x1="50" y1="65" x2="50" y2="93" stroke-width="4" class="klingHigh"/>' +
        '<ellipse cx="50" cy="13.5" rx="4.5" ry="2.5" class="klingLow"/>'
    },
    D10: {
      classification: 'D-10 heavy cruiser',
      size: 'L',
      hull: 6,
      shields: 6,
      impulse: 6,
      warp: 6,
      deflectors: 3,
      sensors: 2,
      control: 3,
      primaryInitial: 3,
      secondaryInitial: 4,
      veerAdjust: -5,
      idPrefix: 'kd10_',
      xml:
        '<path d="M 35,50 L 50,54 65,50 L 58,80 L 42,80 Z"  class="klingLow"/>' +
        '<path d="M 50,15 L 52.5,60 L 47.5,60 Z" stroke-width="3" class="klingLow"/>' +
        '<path d="M 47.5,23 L 52.5,23 L 59,13 A 7,3 0 1 0 41,13 Z" class="klingHigh"/>' +
        '<line x1="23" y1="62" x2="23" y2="89" stroke-width="4" class="klingLow"/>' +
        '<line x1="77" y1="62" x2="77" y2="89" stroke-width="4" class="klingLow"/>' +
        '<path d="M 53,83 L 61,42 L 63,42 L 76,71 L 76.5,83 Z" class="klingHigh"/>' +
        '<path d="M 47,83 L 39,42 L 37,42 L 24,71 L 23.5,83 Z" class="klingHigh"/>' +
        '<ellipse cx="50" cy="13.5" rx="4" ry="2" class="klingLow"/>'
    },
    D9A: {
      classification: 'D-9A advanced battlecruiser',
      size: 'L',
      hull: 5,
      shields: 5,
      impulse: 5,
      warp: 5,
      deflectors: 3,
      sensors: 2,
      control: 3,
      primaryInitial: 3,
      secondaryInitial: 3,
      veerAdjust: +10,
      idPrefix: 'kd9a_',
      xml:
        '<line x1="23" y1="61" x2="23" y2="87" stroke-width="4" class="klingLow"/>' +
        '<line x1="77" y1="61" x2="77" y2="87" stroke-width="4" class="klingLow"/>' +
        '<path d="M 46,43 L 54,43 L 58,55 L 77,69 L 77,77 L 60,80 L 50,78 L 40,80 L 23,77 L 23,69 L 42,55 Z" class="klingHigh"/>' +
        '<path d="M 50,22 L 52,45 L 48,45 Z" stroke-width="2.5" class="klingLow"/>' +
        '<path d="M 48.5,29 L 51.5,29 L 57,22 L 52,11 L 52,15 L 48,15 L 48,11 L 43,22 Z" stroke-width="2" class="klingHigh"/>' +
        '<rect x="38" y="68" width="7" height="13" class="klingLow"/>' +
        '<rect x="55" y="68" width="7" height="13" class="klingLow"/>'
    },
    D7: {
      classification: 'D-7 battlecruiser',
      size: 'L',
      hull: 5,
      shields: 5,
      impulse: 5,
      warp: 4,
      deflectors: 2,
      sensors: 2,
      control: 3,
      primaryInitial: 3,
      secondaryInitial: 3,
      idPrefix: 'kd7_',
      xml:
        '<path d="M 50,15 L 52,60 L 48,60 Z" stroke-width="2" class="klingLow"/>' +
        '<path d="M 47.5,26 L 52.5,26 L 58.5,16.5 A 7,3 0 1 0 41.5,16.5 Z" class="klingHigh"/>' +
        '<line x1="23" y1="61" x2="23" y2="87" stroke-width="4" class="klingLow"/>' +
        '<line x1="77" y1="61" x2="77" y2="87" stroke-width="4" class="klingLow"/>' +
        '<path d="M 50,50 L 67,47 L 77,72 L 77,79 L 50,65 L 23,79 L 23,72 L 33,47 Z" class="klingHigh"/>' +
        '<path d="M 43,58 L 50,60 L 57,58 L 57,71 L 43,71 Z" class="klingLow"/>' +
        '<ellipse cx="50" cy="17" rx="3.5" ry="2" class="klingLow"/>'
    },
    D5: {
      classification: 'D-5 attack cruiser',
      size: 'M',
      hull: 5,
      shields: 4,
      impulse: 4,
      warp: 4,
      deflectors: 2,
      sensors: 2,
      control: 3,
      primaryInitial: 3,
      secondaryInitial: 3,
      veerBoost: +5,
      idPrefix: 'kd7_',
      xml:
        '<path d="M 50,20 L 52,60 L 48,60 Z" stroke-width="1" class="klingLow"/>' +
        '<path d="M 48,31 L 52,31 L 57,23 A 6,3 0 1 0 43,23 Z" class="klingHigh"/>' +
        '<line x1="26" y1="60" x2="26" y2="80" stroke-width="3.5" class="klingLow"/>' +
        '<line x1="74" y1="60" x2="74" y2="80" stroke-width="3.5" class="klingLow"/>' +
        '<path d="M 50,54 L 62,52 L 69,62 L 74,64 L 74,72 L 50,67 L 26,72 L 26,64 L 31,62 L 38,52 Z" class="klingHigh"/>' +
        '<rect x="45" y="60.5" width="10" height="10" class="klingLow"/>' +
        '<ellipse cx="50" cy="23" rx="2.5" ry="1.5" class="klingLow"/>'
    },
    D16: {
      classification: 'D-16D destroyer',
      size: 'M',
      hull: 4,
      shields: 4,
      impulse: 4,
      warp: 4,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 3,
      veerAdjust: +10,
      speedBoost: 1.1,
      idPrefix: 'kd16d_',
      xml:
        '<line x1="30" y1="63" x2="30" y2="83" stroke-width="3.5" class="klingLow"/>' +
        '<line x1="70" y1="63" x2="70" y2="83" stroke-width="3.5" class="klingLow"/>' +
        '<path d="M 50,40 L 55,55 L 70,68 L 70,73 L 50,68 L 30,73 L 30,68 L 45,55 Z" class="klingHigh"/>' +
        '<path d="M 50,22 L 52,46 L 50,54 L 48,46 Z" stroke-width="1" class="klingLow"/>' +
        '<path d="M 49,28 L 51,28 L 57,21 L 50,18 L 43,21 Z" class="klingHigh"/>' +
        '<rect x="46" y="61" width="8" height="10" class="klingLow"/>'
    },
    D2: {
      classification: 'D-2E escort',
      size: 'M',
      hull: 4,
      shields: 4,
      impulse: 4,
      warp: 3,
      deflectors: 2,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 2,
      speedBoost: 1.5,
      veerAdjust: +15,
      idPrefix: 'kd2e_',
      xml:
        '<path d="M 50,20 L 52,60 L 48,60 Z" stroke-width="1" class="klingLow"/>' +
        '<line x1="29" y1="60" x2="29" y2="80" stroke-width="3.5" class="klingLow"/>' +
        '<line x1="71" y1="60" x2="71" y2="80" stroke-width="3.5" class="klingLow"/>' +
        '<path d="M 43,53 L 57,53 L 67,70 L 71,62 L 71,75 L 61,75 L 50,63 L 39,75 L 29,75, 29,62 L 33,70 Z" stroke-width="0" class="klingHigh"/>' +
        '<path d="M 49,31 L 51,31 L 55,24 L 52,19 L 48,19 L 45,24 Z" class="klingHigh"/>' +
        '<rect x="46" y="60" width="8" height="9" class="klingLow"/>'
    },
    L9: {
      classification: 'L-9 frigate',
      size: 'S',
      hull: 4,
      shields: 3,
      impulse: 3,
      warp: 3,
      deflectors: 1,
      sensors: 2,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 2,
      speedBoost: 1.5,
      idPrefix: 'kl9_',
      xml:
        '<path d="M 50,25 L 52,60 L 48,60 Z" stroke-width="1" class="klingLow"/>' +
        '<line x1="36" y1="60" x2="36" y2="79" stroke-width="3.5" class="klingLow"/>' +
        '<line x1="64" y1="60" x2="64" y2="79" stroke-width="3.5" class="klingLow"/>' +
        '<path d="M 43,47 L 50,48 L 57,47 L 64,65 L 64,70 L 50,68 L 36,70 L 36,65 Z" class="klingLow"/>' +
        '<path d="M 35,52 L 50,54 65,52 L 58,73 L 42,73 Z"  class="klingHigh"/>' +
        '<path d="M 47,29 L 53,29 L 56,25 L 52,23 L 48,23 L 44,25 Z" class="klingHigh"/>' +
        '<rect x="45.5" y="65.5" width="9" height="9" class="klingLow"/>'
    },
    L5: {
      classification: 'L-5 light frigate',
      size: 'S',
      hull: 3,
      shields: 3,
      impulse: 3,
      warp: 3,
      deflectors: 1,
      sensors: 1,
      control: 2,
      primaryInitial: 2,
      secondaryInitial: 1,
      speedBoost: 1.25,
      idPrefix: 'kl5_',
      xml:
        '<path d="M 50,26 L 51.5,65 L 48.5,65 Z" stroke-width="1" class="klingLow"/>' +
        '<line x1="30" y1="54" x2="30" y2="75" stroke-width="3.5" class="klingLow"/>' +
        '<line x1="70" y1="54" x2="70" y2="75" stroke-width="3.5" class="klingLow"/>' +
        '<path d="M 43.5,59 L 50,56 L 56.5,59 L 69,57 L 69,68 L 50,75 L 31,68, 31,57 Z" class="klingHigh"/>' +
        '<path d="M 49.5,36 L 50.5,36 L 54,28 A 2,1 0 1 0 46,28 Z" class="klingHigh"/>' +
        '<rect x="46" y="66" width="8" height="9" class="klingLow"/>'
    },
    K5Q: {
      classification: 'K-5Q gunboat',
      size: 'S',
      hull: 3,
      shields: 2,
      impulse: 3,
      warp: 2,
      deflectors: 1,
      sensors: 1,
      control: 2,
      primaryInitial: 1,
      secondaryInitial: 1,
      speedBoost: 1.25,
      idPrefix: 'kk5q_',
      xml:
        '<line x1="32" y1="54" x2="32" y2="68.5" stroke-width="2" class="klingLow"/>' +
        '<line x1="68" y1="54" x2="68" y2="68.5" stroke-width="2" class="klingLow"/>' +
        '<path d="M 50,26 L 51.5,65 L 48.5,65 Z" stroke-width="1" class="klingLow"/>' +
        '<path d="M 43.5,59 L 50,56 L 56.5,59 L 67,58 L 67,68 L 50,75 L 33,68, 33,58 Z" class="klingHigh"/>' +
        '<path d="M 49.5,36 L 50.5,36 L 54,28 A 2,1 0 1 0 46,28 Z" class="klingHigh"/>' +
        '<rect x="44" y="66" width="4" height="8.5" class="klingLow"/>' +
        '<rect x="52" y="66" width="4" height="8.5" class="klingLow"/>' +
        '<line x1="50" y1="65" x2="50" y2="85" stroke-width="3.5" class="klingHigh"/>'
    },
    BOP: {
      classification: 'Bird-of-Prey',
      size: 'S',
      hull: 2,
      shields: 2,
      impulse: 3,
      warp: 2,
      deflectors: 1,
      sensors: 2,
      control: 2,
      primaryOverride: oWeaponOverrides['disruptor3'],
      primaryInitial: 1,
      secondaryInitial: 0,
      speedBoost: 1.1,
      veerAdjust: +20,
      idPrefix: 'kbop_',
      xml:
        '<line x1="29.5" y1="49" x2="29.5" y2="58" stroke-width="1.5" class="klingLow"/>' +
        '<line x1="70.5" y1="49" x2="70.5" y2="58" stroke-width="1.5" class="klingLow"/>' +
        '<path d="M 50,40 L 52,60 L 48,60 Z" stroke-width="1" class="klingLow"/>' +
        '<path d="M 50,53 L 60,65 L 40,65 Z" stroke-width="1" class="klingHigh"/>' +
        '<path d="M 50,61 L 70,56 L 70,60 L 60,68 L 54,69 L 54,66 L 46,66 L 46,69 L 40,68 L 30,60, 30,56 Z" class="klingHigh"/>' +
        '<ellipse cx="50" cy="43" rx="2.5" ry="4.5" class="klingHigh"/>' +
        '<rect x="42.5" y="58.5" width="5.5" height="5.5" class="klingLow"/>' +
        '<rect x="52" y="58.5" width="5.5" height="5.5" class="klingLow"/>'
    },
    BOPA: {
      classification: 'Bird-of-Prey Type-A',
      size: 'S',
      hull: 2,
      shields: 2,
      impulse: 2,
      warp: 2,
      deflectors: 1,
      sensors: 2,
      control: 1,
      primaryInitial: 1,
      secondaryInitial: 0,
      speedBoost: 1.33,
      veerAdjust: +10,
      idPrefix: 'kbopa_',
      xml:
        '<line x1="29" y1="55" x2="29" y2="65" stroke-width="1.5" class="klingLow"/>' +
        '<line x1="71" y1="55" x2="71" y2="65" stroke-width="1.5" class="klingLow"/>' +
        '<path d="M 50,35 L 52,65 L 48,65 Z" stroke-width="1" class="klingLow"/>' +
        '<path d="M 50,59 L 70,62 L 70,64 L 50,72 L 30,64, 30,62 Z" class="klingHigh"/>' +
        '<ellipse cx="50" cy="63" rx="6.5" ry="9" class="klingHigh"/>' +
        '<ellipse cx="50" cy="40" rx="3" ry="5" class="klingHigh"/>' +
        '<rect x="46" y="62" width="2" height="12" class="klingLow"/>' +
        '<rect x="52" y="62" width="2" height="12" class="klingLow"/>'
    }
  };
  var oOfficers = {
    'captain': {
      ranks: ['Capt.', 'Cdre.'],
      location: 'bridge',
      station: 'command',
      perq: 0 // skill diff
    },
    'helmsman': {
      ranks: ['Lt. jg.', 'Lt.'],
      location: 'helm',
      station: 'conn',
      perq: 5 // + weapon arcs
    },
    'navigator': {
      ranks: ['Ensign', 'Lt.'],
      location: 'navigation',
      station: 'ops',
      perq: 15 // + turn arcs
    },
    'chief engineer': {
      ranks: ['Lt. Cmdr.', 'Cmdr.'],
      location: 'engineering',
      station: 'engineering',
      perq: 1 // + warp repair
    },
    'first officer': {
      ranks: ['Lt. Cmdr.', 'Cmdr.'],
      position: 'tactical',
      station: 'tactical',
      perq: 1 // + damage
    },
    'science officer': {
      ranks: ['Lt. jg.', 'Lt.'],
      position: 'science',
      station: 'science',
      perq: 1 // + weapon range
    }
  };

})();