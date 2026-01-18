
/**
 * Binary search for the index of an element in a sorted array.
 * Returns the index of the first element that satisfies the predicate (lower bound),
 * or array.length if no element satisfies it.
 * 
 * @param array Sorted array
 * @param compare Comparator function returning < 0 if a < b, > 0 if a > b, 0 if equal.
 *                Actually, for lower_bound style:
 *                We want to find first index where array[index] >= value.
 *                Or generally, generic binary search.
 */
export function binarySearch<T>(array: T[], compare: (item: T) => number): number {
    let low = 0;
    let high = array.length;

    while (low < high) {
        const mid = (low + high) >>> 1;
        const cmp = compare(array[mid]);

        if (cmp < 0) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

/**
 * Perform a binary search to find the index of the first element for which
 * the comparator returns >= 0.
 * Assumes the array is sorted such that comparator results are monotonic.
 * equivalent to std::lower_bound behavior if comparator is (item) => item - target
 */
export function lowerBound<T>(array: T[], value: number, getKey: (item: T) => number): number {
    let low = 0;
    let high = array.length;

    while (low < high) {
        const mid = (low + high) >>> 1;
        if (getKey(array[mid]) < value) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

export function upperBound<T>(array: T[], value: number, getKey: (item: T) => number): number {
    let low = 0;
    let high = array.length;

    while (low < high) {
        const mid = (low + high) >>> 1;
        if (getKey(array[mid]) <= value) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}
