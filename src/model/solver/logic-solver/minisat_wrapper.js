import C_MINISAT from './minisat.js';

import _ from '../../../workarounds/_';


// var C_MINISAT = require("./minisat.js");
// var _ = require("underscore");

// minisat.js is a WebAssembly build (see build-minisat.sh). All solvers share one instance (per JS context), since each
// WebAssembly memory reserves gigabytes of address space: with an instance per solver, browsers run out after a few
// dozen solvers that haven't been garbage collected yet.
var instance = null; // { C, liveCount, dead }

// Once no solvers are left, an instance whose memory grew past this is dropped (WebAssembly memory never shrinks)
var MAX_IDLE_MEMORY = 64 * 1024 * 1024;

var getInstance = function () {
  if (!instance) {
    // The factory is async, but since it is built to compile and instantiate synchronously, the module object we pass
    // in is ready as soon as the call returns.
    var C = {};
    C_MINISAT(C).catch(function () {
      // Failures are detected (and thrown) below
    });
    if (!C._createSolver) {
      throw new Error('MiniSat failed to initialize');
    }
    instance = { C: C, liveCount: 0, dead: false };
  }
  return instance;
};

// After an error (e.g. an abort when out of memory), the instance can't be used again, so new solvers get a new one
var markDead = function (inst) {
  inst.dead = true;
  if (instance === inst) {
    instance = null;
  }
};

var freeSolver = function (inst, ptr) {
  inst.liveCount--;
  if (!inst.dead) {
    try {
      inst.C._deleteSolver(ptr);
    } catch (e) {
      markDead(inst);
    }
  }
  if (instance === inst && inst.liveCount === 0 && inst.C.HEAPU8.length > MAX_IDLE_MEMORY) {
    instance = null;
  }
};

// Frees the solvers that aren't disposed (see dispose) once they are garbage collected
var registry =
  typeof FinalizationRegistry !== 'undefined' ?
    new FinalizationRegistry(function (held) {
      freeSolver(held.instance, held.ptr);
    })
  : null;

var MiniSat;
MiniSat = function () {
  // A MiniSat object wraps a "native" MiniSat solver.  You can
  // have as many MiniSat objects as you want, and they are all
  // independent.
  //
  // C is the "module" object created by Emscripten.
  //
  // The methods available on `C` include the global functions we
  // define in `logic-solver.cc`, each prefixed with `_`, and a varied
  // assortment of helpers put there by Emscripten, some of which are
  // documented here:
  // http://kripken.github.io/emscripten-site/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html
  //
  // See the README in the meteor/minisat repo for more notes about
  // our build of MiniSat.
  var inst = (this._instance = getInstance());
  var C = (this._C = inst.C);

  this._native = {
    getStackPointer: function () {
      return C.stackSave();
    },
    setStackPointer: function (ptr) {
      C.stackRestore(ptr);
    },
    allocateBytes: function (len) {
      return C.stackAlloc(len);
    },
    savingStack: function (func) {
      var SP = this.getStackPointer();
      try {
        return func(this, C);
      } finally {
        this.setStackPointer(SP);
      }
    },
  };

  this._ptr = this._call(function (C) {
    return C._createSolver();
  });
  inst.liveCount++;
  if (registry) {
    registry.register(this, { instance: inst, ptr: this._ptr }, this);
  }
};

// Calls into the instance, marking it dead if that fails
MiniSat.prototype._call = function (func) {
  if (this._instance.dead) {
    throw new Error('MiniSat instance is no longer usable');
  }
  try {
    return func(this._C);
  } catch (e) {
    markDead(this._instance);
    throw e;
  }
};

MiniSat.prototype._getPtr = function () {
  if (!this._ptr) {
    throw new Error('MiniSat solver was disposed');
  }
  return this._ptr;
};

// Frees the native solver now (instead of when this is garbage collected). It can't be used afterward.
MiniSat.prototype.dispose = function () {
  if (this._ptr) {
    if (registry) {
      registry.unregister(this);
    }
    freeSolver(this._instance, this._ptr);
    this._ptr = 0;
  }
};

// Make sure MiniSat has allocated space in its model for v,
// even if v is unused.  If we have variables A,B,C,D which
// are numbers 1,2,3,4, for example, but we never actually use
// C and D, calling ensureVar(4) will make MiniSat give us
// solution values for them anyway.
MiniSat.prototype.ensureVar = function (v) {
  var ptr = this._getPtr();
  this._call(function (C) {
    C._ensureVar(ptr, v);
  });
};

// Add a clause, in the form of an array of Logic.NumTerms.
// Returns true if the problem is still satisfiable
// (as far as we know without doing more work), and false if
// we can already tell that it is unsatisfiable.
MiniSat.prototype.addClause = function (terms) {
  var ptr = this._getPtr();
  var self = this;
  return this._call(function () {
    return self._addClause(ptr, terms);
  });
};

MiniSat.prototype._addClause = function (ptr, terms) {
  return this._native.savingStack(function (native, C) {
    var termsPtr = C.stackAlloc((terms.length + 1) * 4);
    _.each(terms, function (t, i) {
      C.setValue(termsPtr + i * 4, t, 'i32');
    });
    C.setValue(termsPtr + terms.length * 4, 0, 'i32'); // 0-terminate
    return C._addClause(ptr, termsPtr) ? true : false;
  });
};

MiniSat.prototype.solve = function () {
  var ptr = this._getPtr();
  return this._call(function (C) {
    return C._solve(ptr) ? true : false;
  });
};

MiniSat.prototype.solveAssuming = function (v) {
  var ptr = this._getPtr();
  return this._call(function (C) {
    return C._solveAssuming(ptr, v) ? true : false;
  });
};

MiniSat.prototype.getSolution = function () {
  var solution = [null]; // no 0th var
  var C = this._C;
  var ptr = this._getPtr();
  var numVars = C._getNumVars(ptr);
  var solPtr = C._getSolution(ptr);
  for (var i = 0; i < numVars; i++) {
    // 0 is Minisat::l_True (lifted "true").
    // Internally, Minisat has three states for a variable:
    // true, false, and undetermined.  It doesn't distinguish
    // between "false" and "undetermined" in solutions though
    // (I think it sets undetermined variables to false).
    solution[i + 1] = C.getValue(solPtr + i, 'i8') === 0;
  }
  return solution;
};

MiniSat.prototype.retireVar = function (v) {
  var ptr = this._getPtr();
  this._call(function (C) {
    C._retireVar(ptr, v);
  });
};

// The "conflict clause" feature of MiniSat is not what it sounds
// like, unfortunately -- it doesn't help explain conflicts.
// It only tells us which assumption vars are to blame for a failed
// solveAssuming (and we only ever pass one var).
// We keep this function around in case we discover a use for it.
MiniSat.prototype.getConflictClause = function () {
  var C = this._C;
  var ptr = this._getPtr();
  var numTerms = C._getConflictClauseSize(ptr);
  var clausePtr = C._getConflictClause(ptr);
  var terms = [];
  for (var i = 0; i < numTerms; i++) {
    var t = C.getValue(clausePtr + i * 4, 'i32');
    var v = t >>> 1;
    var s = t & 1 ? -1 : 1;
    terms[i] = v * s;
  }
  return terms;
};
export default MiniSat;
