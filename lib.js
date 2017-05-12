/*
 * Internal library functions.
 */

const R = require('ramda')

// Given a list of arguments, returns a function that accepts a function
// and ultimately returns the result of calling the function with
// the original arguments.
const callWith = (...args) => f => f(...args)
module.exports.callWith = callWith

// Promise.resolve and Promise.reject bound to Promise
const resolve = Promise.resolve.bind(Promise)
module.exports.resolve = resolve

const reject = Promise.reject.bind(Promise)
module.exports.reject = reject

// Creates something Symbol-like if the environment doesn't have Symbols
const symbolFallback = R.is(Function, Symbol) ? Symbol : () => Object.freeze({})
module.exports.symbolFallback = symbolFallback

// For debugging, just console.log
const l = R.bind(console.log, console)
module.exports.l = l

// Shorthand for wrapping a predicate and message as a tuple
const pc = (predicate, message) => [ predicate, message ]
module.exports.pc = pc

// Passes function arguments through a list of predicates
const preconditions = (...conditions) => f => {
  const callF = (...args) => {
    // Call each precondition with the arguments passed to the function
    const results = R.map(
      R.compose(callWith(...args), R.head),
      conditions
    )

    // If all the preconditions passed, call the function
    if (R.all(Boolean, results)) {
      return f(...args)
    }

    // Otherwise throw an Error whose message is the failure
    // message of the first failed precondition
    throw new Error(R.compose(
      R.defaultTo('failed precondition'),
      R.last,
      R.nth(R.__, conditions),
      R.findIndex(R.not)
    )(results))
  }
  Object.defineProperty(callF, 'length', { value: f.length })
  return callF
}
module.exports.preconditions = preconditions

const isStringRepresentable = R.anyPass(R.map(R.unary(R.is), [ String, Number, Symbol ]))
module.exports.isStringRepresentable = isStringRepresentable

const isDefined = R.complement(R.isNil)
module.exports.isDefined = isDefined
