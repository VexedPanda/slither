// Based on meteor/logic-solver.cc from the meteor/minisat repo (see build-minisat.sh), changed so that one WebAssembly
// instance can hold many solvers: each function takes the solver, instead of using one global solver per instance.
// (Each WebAssembly memory reserves gigabytes of address space, so an instance per solver runs out after a few dozen.)

#include "minisat/simp/SimpSolver.h"

using namespace Minisat;

extern "C" {

  SimpSolver *createSolver() {
    SimpSolver *solver = new SimpSolver();
    // Turn off variable elimination, which is problematic for
    // incremental solving.
    solver->eliminate(/*turn_off_elim = */true);
    solver->newVar(); // create dummy "0" variable
    return solver;
  }

  void deleteSolver(SimpSolver *solver) {
    delete solver;
  }

  // Make sure enough variables have been allocated to hold
  // "v" (not counting the dummy "0" variable).
  void ensureVar(SimpSolver *solver, int v) {
    while (v >= solver->nVars()) {
      solver->newVar();
    }
  }

  // terms is 0-terminated.  Negative numbers are negative
  // terms.  1, 2, and 3 mean variables 1, 2, and 3.
  // -1, -2, and -3 mean "not 1", "not 2", and "not 3".
  bool addClause(SimpSolver *solver, int *terms) {
    vec<Lit> vars;
    while (*terms) {
      int v = *terms;
      bool isNot = false;
      if (v < 0) {
        v = -v;
        isNot = true;
      }
      ensureVar(solver, v);
      vars.push(mkLit(Var(v), isNot));
      terms++;
    }
    return solver->addClause(vars);
  }

  bool solve(SimpSolver *solver) {
    return solver->solve();
  }

  // Returns a pointer to a sequence of bytes representing
  // the solution values of the variables, starting with
  // variable 1 (that is, the first byte is variable 1,
  // the second byte is variable 2, etc.).  A value of
  // 0 means "true", and anything else means "false".
  uint8_t * getSolution(SimpSolver *solver) {
    // Adding 1 to the pointer skips the dummy "0" variable.
    return (uint8_t *)((lbool *)solver->model) + 1;
  }

  // The number of variables allocated, not including the
  // dummy "0" variable.
  int getNumVars(SimpSolver *solver) {
    return solver->nVars() - 1;
  }

  // solve while temporarily assuming variable v is true.
  bool solveAssuming(SimpSolver *solver, int v) {
    vec<Lit> assumps;
    assumps.push(mkLit(Var(v)));
    return solver->solve(assumps,
                         /*do_sump = */true,
                         /*turn_off_simp = */false);
  }

  // mark a Var as false, forever.
  void retireVar(SimpSolver *solver, int v) {
    solver->addClause(mkLit(Var(v), true));
  }

  int getConflictClauseSize(SimpSolver *solver) {
    return solver->conflict.size();
  }

  // Returns a pointer to an int[] of length getConflictClauseSize(), where each int is 2*v + s where v is the variable
  // number and s is 1 for "not".
  int * getConflictClause(SimpSolver *solver) {
    return (int *)((Lit *)*const_cast<vec<Lit> *>(&solver->conflict.toVec()));
  }
};
