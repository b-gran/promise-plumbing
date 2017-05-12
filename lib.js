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
  const callConditionsWithArgs2 = (...args) => {
    let index = 0

    while (index < conditions.length) {
      const condition = conditions[index]
      if (!condition[0](...args)) {
        return failCondition(condition)
      }
      index += 1
    }

    return f(...args)
  }

  const callConditionsWithArgs = (...args) => {
    const result = R.reduce(
      (passOrFailureMessage, condition) => (
        passOrFailureMessage === true &&
        (!!condition[0](...args) || condition[1] || 'failed precondition')
      ),
      true,
      conditions
    )

    return result === true ? f(...args) : failCondition(result)
  }

  Object.defineProperty(callConditionsWithArgs, 'length', { value: f.length })
  return callConditionsWithArgs

  function failCondition (condition) {
    throw new Error(condition[1] || 'failed precondition')
  }
}
module.exports.preconditions = preconditions

const isStringRepresentable = R.anyPass(R.map(R.unary(R.is), [ String, Number, Symbol ]))
module.exports.isStringRepresentable = isStringRepresentable

const isDefined = R.complement(R.isNil)
module.exports.isDefined = isDefined
