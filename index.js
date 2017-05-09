const R = require('ramda')
const assert = require('assert')

// Given a list of arguments, returns a function that accepts a function
// and ultimately returns the result of calling the function with
// the original arguments.
const _callWith = (...args) => f => f(...args)

// Promise.resolve and Promise.reject bound to Promise
const _resolve = Promise.resolve.bind(Promise)
const _reject = Promise.reject.bind(Promise)

// Creates something Symbol-like if the environment doesn't have Symbols
const _symbolFallback = R.is(Function, Symbol) ? Symbol : () => Object.freeze({})

// For debugging, just console.log
const _l = R.bind(console.log, console)

const _pc = (predicate, message) => [ predicate, message ]
const _preconditions = (...conditions) => f => (...args) => {
  // Call each precondition with the arguments passed to the function
  const results = R.map(
    R.compose(_callWith(...args), R.head),
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

// Does an operation while a test returns true. The test and operation can be
// asynchronous operations. If either function rejects, exits immediately.
// This function always performs the operation at least once --
// just like the "do while" control structure.
const doWhilst = (operation, test) => whilst(
  results => R.isEmpty(results) || test(results),
  operation
)
module.exports.doWhilst = doWhilst

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

const _failure = _symbolFallback('failure')
const _isHeadFailure = R.compose(R.equals(_failure), R.head)

// Retry an operation some number of times before reporting failure.
// An operation "fails" if either
//   1) the operation is synchronous and it throws
//   2) the operation is a Promise and it is rejected
const retry = _preconditions(
  _pc(R.propSatisfies(R.is(Number), 'times'), 'times must be a number')
)(
  ({ times, interval = 0 }, task) => doWhilst(
    // Do the task and always have a fulfilment tuple of
    //    [ maybeFailed, result ]
    // where maybeFailed is the failure symbol if the operation failed.
    // This way, the task can return an Error or a falsey or nil value.
    () => task()
      .then(result => [ null, result ])
      .catch(err => [ _failure, err ]),

    // Continue while the latest operation failed and we
    // haven't done it "times" times
    R.allPass([
      R.compose(_isHeadFailure, R.last),
      R.compose(R.gt(times), R.length)
    ])
  ).then(R.compose(
    R.ifElse(_isHeadFailure, R.compose(_reject, R.last), R.last),
    R.last
  ))
)
module.exports.retry = retry

// A Promise that is fulfilled after some number of milliseconds.
const delay = _preconditions(
  _pc(R.is(Number), 'the duration must be a number')
)(
  duration => new Promise(resolve => setTimeout(
    () => resolve(),
    R.is(Number, duration) ? Math.max(duration, 0) : 0
  ))
)
module.exports.delay = delay
