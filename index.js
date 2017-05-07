const R = require('ramda')

// Given a list of arguments, returns a function that accepts a function
// and ultimately returns the result of calling the function with
// the original arguments.
const _callWith = (...args) => f => f(...args)

// Promise.resolve and Promise.reject bound to Promise
const _resolve = Promise.resolve.bind(Promise)
const _reject = Promise.reject.bind(Promise)

// Given a function f that may or may not return a Promise, returns a Promise-returning
// function which returns a Promise that resolves to the return value of f
const wrap = R.compose(
  R.tryCatch(R.__, _reject),
  R.converge(R.compose, [ R.always(_resolve), R.identity ])
)
module.exports.wrap = wrap

// Passes a MaybePromise to a list of branching functions and resolves
// to the list of branch results. The branching functions can be Promise-returning
// or synchronous, and the value can either be a Promise or any other value.
const branch = (...branches) => valueOrPromise => Promise.resolve(valueOrPromise)
  .then(fulfilment => Promise.all(R.map(
    _callWith(fulfilment),
    branches
  )))
module.exports.branch = branch

const _whilstRec = (test, operation, results) => {
  return test(results)
    .then(R.ifElse(
      R.identity,
      () => operation(results)
          .then(result => _whilstRec(test, operation, [ ...results, result ])),
      R.always(results)
    ))
}

// Does an operation while a test returns true. The test and operation can be
// asynchronous operations. If either function rejects, exits immediately.
const whilst = (test, operation) => {
  return _whilstRec(
    wrap(test),
    wrap(operation),
    []
  )
}
module.exports.whilst = whilst

// Asynchronous version of compose with arguments reversed.
// Arguments to the returned function can be Promises -- they will
// be resolved in a non-deterministic order before being passed to
// the input functions.
const pipe = (...functions) => (...args) => Promise
  .all(R.map(_resolve, args))
  .then(resolvedArguments => R.reduce(
    (promise, step) => promise.then(step),
    wrap(R.head(functions))(...resolvedArguments),
    R.tail(functions)
  ))
module.exports.pipe = pipe

const _symbolFallback = R.is(Function, Symbol) ? Symbol : () => Object.freeze({})
const _failure = _symbolFallback('failure')
const retry = ({ times, interval }, task) => whilst(
  results => R.or(
    R.isEmpty(results),
    R.and(
      R.path([ results.length - 1, 0 ], results) === _failure,
      results.length < times
    )
  ),
  () => task()
    .then(result => [ null, result ])
    .catch(err => [ _failure, err ])
).then(results => {
  const lastResult = R.last(results)
  return lastResult[0] === _failure
    ? Promise.reject(lastResult[1])
    : lastResult[1]
})
module.exports.retry = retry

const delay = duration => new Promise(resolve => setTimeout(
  () => resolve(),
  R.is(Number, duration) ? Math.max(duration, 0) : 0
))
module.exports.delay = delay
